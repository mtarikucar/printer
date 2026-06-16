import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { scenePresets } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";

// Admin CRUD for the scene axis. Scenes are DB-backed so they can be added,
// edited, reordered and enabled/disabled without a deploy. The English
// `promptFragment` is the variable injected into the FLUX generation prompt.

export async function GET() {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const rows = await db
    .select()
    .from(scenePresets)
    .orderBy(asc(scenePresets.sortOrder));
  return NextResponse.json({ scenePresets: rows });
}

const createSchema = z.object({
  // Stable, immutable key. Lowercase letters/numbers/underscores only so it's
  // safe to persist on previews.scene and reference in code.
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "slug: yalnızca a-z, 0-9, _"),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).optional().default(""),
  promptFragment: z.string().trim().max(2000).optional().default(""),
  peopleHint: z.enum(["single", "multiple", "any"]).optional().default("any"),
  enabled: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
});

export async function POST(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  try {
    const body = createSchema.parse(await request.json());

    const existing = await db
      .select({ id: scenePresets.id })
      .from(scenePresets)
      .where(eq(scenePresets.slug, body.slug))
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Bu slug zaten kullanılıyor" },
        { status: 409 }
      );
    }

    const [created] = await db
      .insert(scenePresets)
      .values({
        slug: body.slug,
        label: body.label,
        description: body.description || null,
        promptFragment: body.promptFragment,
        peopleHint: body.peopleHint,
        enabled: body.enabled,
        sortOrder: body.sortOrder,
      })
      .returning();

    return NextResponse.json({ scenePreset: created }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Oluşturulamadı" }, { status: 500 });
  }
}
