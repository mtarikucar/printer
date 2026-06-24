import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { previews } from "@/lib/db/schema";
import { getPreviewGenerationQueue } from "@/lib/queue/queues";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser, getOrCreateAnonymousId } from "@/lib/services/customer-auth";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import {
  FREE_GENERATION_ACCOUNT_CAP,
  DEVICE_FREE_CAP,
  IP_FREE_CAP,
  FREE_GENERATION_WINDOW_MS,
} from "@/lib/config/generation";
import { isPhoneVerificationRequired } from "@/lib/services/sms";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { verifyTurnstileToken } from "@/lib/services/turnstile";
import { isValidTemplateSlug, DEFAULT_TEMPLATE_SLUG, getTemplate } from "@/lib/create/design-templates";
import { eq, count } from "drizzle-orm";

const generateSchema = z.object({
  photoKey: z.string().min(1),
  // Optional multi-image fusion set (Meshy multi-image-to-3d accepts 1-4
  // images). When present, generation fuses several reference angles into a
  // more detailed mesh. Only honored for non-stylized templates (see below).
  photoKeys: z.array(z.string().min(1)).max(4).optional(),
  figurineSize: z.enum(["kucuk", "orta", "buyuk"]),
  // Design template (formerly "style"): validated against the registry, so a
  // new template is a registry-only change — no enum edit here.
  style: z
    .string()
    .refine(isValidTemplateSlug, "invalid template")
    .default(DEFAULT_TEMPLATE_SLUG),
  modifiers: z.array(z.enum(["pixel_art"])).optional().default([]),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    // Generation costs us money per call (Meshy/Tripo), so it now REQUIRES
    // login. Guest checkout for the physical product is unaffected — only the
    // generate step is gated, not ordering.
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json(
        { error: d["api.auth.required"], code: "auth_required" },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Extract turnstileToken before Zod validation
    const { turnstileToken, ...rest } = body;
    const ip = extractClientIp(request);

    if (!(await verifyTurnstileToken(turnstileToken ?? "", ip))) {
      return NextResponse.json(
        { error: d["api.turnstile.failed"] },
        { status: 403 }
      );
    }

    const validated = generateSchema.parse(rest);

    // Resolve the full photo set. Multi-image fusion is only meaningful for
    // non-stylized templates (object/realistic) — for stylized templates the
    // FLUX restyle reinterprets each photo independently, so extra angles add
    // nothing. Collapse to the single primary photo there (defense-in-depth;
    // the UI already hides multi-upload for stylized templates). The primary
    // photoKey is always element 0 so downstream (display/order) is unchanged.
    const tpl = getTemplate(validated.style);
    const requestedKeys =
      validated.photoKeys && validated.photoKeys.length > 0
        ? validated.photoKeys
        : [validated.photoKey];
    const allowMulti = !!tpl && !tpl.stylize;
    // De-dupe + cap at 4, primary first.
    const photoKeys = allowMulti
      ? Array.from(new Set([validated.photoKey, ...requestedKeys])).slice(0, 4)
      : [validated.photoKey];

    // Validate every key is under the photos/ directory (no traversal).
    for (const key of photoKeys) {
      if (!key.startsWith("photos/") || key.includes("..")) {
        return NextResponse.json(
          { error: d["api.order.createFailed"] },
          { status: 400 }
        );
      }
    }

    const photoUrl = getPublicUrl(validated.photoKey);

    // Email verification gate (anti-abuse): an unverified email must never burn
    // Meshy/Tripo budget. Checked BEFORE the free-tier counters so unverified
    // users don't even consume a device/IP slot.
    const acct = await db.query.users.findFirst({
      where: (u, { eq: eq2 }) => eq2(u.id, session.userId),
      columns: { emailVerified: true, phoneVerified: true },
    });
    if (!acct?.emailVerified) {
      return NextResponse.json(
        { error: d["api.preview.emailNotVerified"], code: "email_not_verified" },
        { status: 403 }
      );
    }

    // Free-generation gate. A paying customer (any paid order) is never the
    // abuse target, so they're exempt from every cap. Free-tier users are
    // capped on three independent axes — per account, per device cookie, and
    // per client IP — so re-signing up with a new email on the same
    // device/network doesn't multiply the free Meshy budget.
    const hasPaidOrder = await db.query.orders.findFirst({
      where: (o, { eq: eq2 }) => eq2(o.userId, session.userId),
      columns: { id: true },
    });

    if (!hasPaidOrder) {
      // Phone verification gate (anti-abuse, feature-flagged). Only enforced
      // once an SMS provider is credentialed; paying customers are exempt.
      if (isPhoneVerificationRequired() && !acct.phoneVerified) {
        return NextResponse.json(
          { error: d["api.preview.phoneNotVerified"], code: "phone_not_verified" },
          { status: 403 }
        );
      }

      const [{ value: previewCount }] = await db
        .select({ value: count() })
        .from(previews)
        .where(eq(previews.userId, session.userId));

      if (previewCount >= FREE_GENERATION_ACCOUNT_CAP) {
        return NextResponse.json(
          { error: d["api.preview.limitReached"], code: "account_cap" },
          { status: 429 }
        );
      }

      // Cross-account device + IP ceilings (calendar-month buckets).
      // rateLimitAsync is Redis-backed + atomic, so these hold across instances.
      const deviceId = await getOrCreateAnonymousId();
      const month = new Date().toISOString().slice(0, 7); // YYYY-MM
      const dev = await rateLimitAsync(
        `freegen:dev:${deviceId}:${month}`,
        DEVICE_FREE_CAP,
        FREE_GENERATION_WINDOW_MS
      );
      if (!dev.success) {
        return NextResponse.json(
          { error: d["api.preview.limitReached"], code: "device_cap" },
          { status: 429 }
        );
      }
      const ipRl = await rateLimitAsync(
        `freegen:ip:${ip}:${month}`,
        IP_FREE_CAP,
        FREE_GENERATION_WINDOW_MS
      );
      if (!ipRl.success) {
        return NextResponse.json(
          { error: d["api.preview.limitReached"], code: "ip_cap" },
          { status: 429 }
        );
      }
    }

    const [preview] = await db
      .insert(previews)
      .values({
        userId: session.userId,
        photoKey: validated.photoKey,
        photoUrl,
        // Persist the multi-image set only when there's more than one photo, so
        // single-photo previews keep a null column (and the cleanup worker falls
        // back to photoKey).
        photoKeys: photoKeys.length > 1 ? photoKeys : null,
        figurineSize: validated.figurineSize,
        style: validated.style,
        modifiers: validated.modifiers.length > 0 ? validated.modifiers : null,
        status: "generating",
      })
      .returning();

    await getPreviewGenerationQueue().add("generate-variations", {
      previewId: preview.id,
      imageUrl: photoUrl,
      photoKey: validated.photoKey,
      photoKeys: photoKeys.length > 1 ? photoKeys : undefined,
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
