import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { previews } from "@/lib/db/schema";
import { getPreviewGenerationQueue } from "@/lib/queue/queues";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { verifyTurnstileToken } from "@/lib/services/turnstile";
import { eq, count } from "drizzle-orm";

const generateSchema = z.object({
  photoKey: z.string().min(1),
  figurineSize: z.enum(["kucuk", "orta", "buyuk"]),
  style: z.enum(["realistic", "disney", "anime", "chibi"]).default("realistic"),
  modifiers: z.array(z.enum(["pixel_art"])).optional().default([]),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    const session = await getSessionUser();

    const body = await request.json();

    // Extract turnstileToken before Zod validation
    const { turnstileToken, ...rest } = body;
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for") ??
      "unknown";

    if (!(await verifyTurnstileToken(turnstileToken ?? "", ip))) {
      return NextResponse.json(
        { error: d["api.turnstile.failed"] },
        { status: 403 }
      );
    }

    const validated = generateSchema.parse(rest);
    const photoUrl = getPublicUrl(validated.photoKey);

    // Preview limit: 3 for users who haven't paid
    if (session) {
      const hasPaidOrder = await db.query.orders.findFirst({
        where: (o, { and, eq: eq2, ne: ne2 }) =>
          and(
            eq2(o.userId, session.userId),
            ne2(o.status, "pending_payment")
          ),
        columns: { id: true },
      });

      if (!hasPaidOrder) {
        const [{ value: previewCount }] = await db
          .select({ value: count() })
          .from(previews)
          .where(eq(previews.userId, session.userId));

        if (previewCount >= 3) {
          return NextResponse.json(
            { error: d["api.preview.limitReached"] },
            { status: 429 }
          );
        }
      }
    }

    const [preview] = await db
      .insert(previews)
      .values({
        userId: session?.userId ?? null,
        photoKey: validated.photoKey,
        photoUrl,
        figurineSize: validated.figurineSize,
        style: validated.style,
        modifiers: validated.modifiers.length > 0 ? validated.modifiers : null,
        status: "generating",
      })
      .returning();

    await getPreviewGenerationQueue().add("generate-preview", {
      previewId: preview.id,
      imageUrl: photoUrl,
      photoKey: validated.photoKey,
      style: validated.style,
      modifiers: validated.modifiers,
    });

    return NextResponse.json({ previewId: preview.id });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error("Preview generation request failed:", error);
    return NextResponse.json(
      { error: d["api.order.createFailed"] },
      { status: 500 }
    );
  }
}
