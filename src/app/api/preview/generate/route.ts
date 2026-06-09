import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { previews } from "@/lib/db/schema";
import { getPreviewGenerationQueue } from "@/lib/queue/queues";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { verifyTurnstileToken } from "@/lib/services/turnstile";
import { eq, count } from "drizzle-orm";

const generateSchema = z.object({
  photoKey: z.string().min(1),
  figurineSize: z.enum(["kucuk", "orta", "buyuk"]),
  style: z.enum(["realistic", "storybook", "anime", "chibi", "object"]).default("storybook"),
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

    // Validate photoKey is under the photos/ directory
    if (!validated.photoKey.startsWith("photos/") || validated.photoKey.includes("..")) {
      return NextResponse.json(
        { error: d["api.order.createFailed"] },
        { status: 400 }
      );
    }

    const photoUrl = getPublicUrl(validated.photoKey);

    // Preview limit: 3 for users who haven't paid, also limit anonymous users
    if (session) {
      const hasPaidOrder = await db.query.orders.findFirst({
        where: (o, { eq: eq2 }) => eq2(o.userId, session.userId),
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
    } else {
      // Anonymous users: rate limit by IP to prevent abuse — Redis-backed
      // so the limit is shared across instances. Meshy costs money per call,
      // so an in-memory-only limit was a real exposure under multi-instance
      // deploy.
      const anonIp = extractClientIp(request);
      const rl = await rateLimitAsync(`preview:${anonIp}`, 3, 60 * 60 * 1000); // 3 previews per hour
      if (!rl.success) {
        return NextResponse.json(
          { error: d["api.preview.limitReached"] },
          { status: 429 }
        );
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
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: (error as Error & { errors?: unknown }).errors }, { status: 400 });
    }
    console.error("Preview generation request failed:", error);
    return NextResponse.json(
      { error: d["api.order.createFailed"] },
      { status: 500 }
    );
  }
}
