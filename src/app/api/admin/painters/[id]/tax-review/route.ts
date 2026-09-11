import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import { formatAdminNoteLine } from "@/lib/config/order-status-policy";

/**
 * Admin closes a painter's manual tax review. Same contract as
 * /api/admin/manufacturers/[id]/tax-review.
 *
 * Painters carry the same `requiresManualTaxReview` flag and the admin list
 * has a "Manuel İnceleme" tab that filters on it, but nothing could clear it,
 * so a flagged painter stayed in that tab forever. Painter registration does
 * not set the flag today; a row carries it only when it was set by hand, and
 * those rows still need an explicit "I checked the vergi levhası" step.
 *
 * The admin must say what they checked. The line (who, when, what) is appended
 * to painters.notes, never written over it: painter_actions rows need an
 * order, so partner-level decisions have no other audit home.
 */
// Every failure carries Turkish copy, and the route returns it verbatim. A
// bare z.string() answered a missing note with zod's English "Invalid input:
// expected string, received undefined", and .max() had no message either.
const NOTE_REQUIRED = "Neyi kontrol ettiğinizi kısaca yazın (en az 3 karakter).";
const schema = z.object(
  {
    note: z
      .string({ error: NOTE_REQUIRED })
      .trim()
      .min(3, { error: NOTE_REQUIRED })
      .max(500, { error: "Not en fazla 500 karakter olabilir." }),
  },
  { error: "Geçersiz istek." }
);

// Same shape check the payout routes use.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;
  // A malformed id names no painter. Unchecked it would reach Postgres as an
  // invalid uuid and come back as a 500.
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Boyacı bulunamadı" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }

  const line = formatAdminNoteLine(
    `Vergi incelemesi kapatıldı (${a.session.user.email}): ${parsed.data.note}`
  );

  // Guarded on the flag still being set, so a double click (or two admins)
  // writes one audit line, not two.
  const [updated] = await db
    .update(painters)
    .set({
      requiresManualTaxReview: false,
      notes: sql`CASE WHEN ${painters.notes} IS NULL OR ${painters.notes} = '' THEN ${line} ELSE ${painters.notes} || E'\n' || ${line} END`,
      updatedAt: new Date(),
    })
    .where(and(eq(painters.id, id), eq(painters.requiresManualTaxReview, true)))
    .returning({ id: painters.id });

  if (!updated) {
    const exists = await db.query.painters.findFirst({
      where: eq(painters.id, id),
      columns: { id: true },
    });
    return exists
      ? NextResponse.json(
          { error: "Bu boyacının açık bir vergi incelemesi yok." },
          { status: 409 }
        )
      : NextResponse.json({ error: "Boyacı bulunamadı" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
