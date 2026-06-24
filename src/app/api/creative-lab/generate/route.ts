import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { creativeLabJobs } from "@/lib/db/schema";
import { getCreativeLabQueue } from "@/lib/queue/queues";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
import {
  isCreativeLabProduct,
  type CreativeLabProduct,
} from "@/lib/services/creative-lab";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Creative Lab costs ~36 credits/job — gate behind login + verified email + a
// per-account cap so it can't be drained by anonymous/abusive requests.
const CREATIVE_LAB_ACCOUNT_CAP = 10;

const schema = z.object({
  product: z.string().refine(isCreativeLabProduct, "invalid product"),
  photoKey: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json(
        { error: d["api.auth.required"], code: "auth_required" },
        { status: 401 },
      );
    }

    const { product, photoKey } = schema.parse(await request.json());
    const prod = product as CreativeLabProduct;

    if (!photoKey.startsWith("photos/") || photoKey.includes("..")) {
      return NextResponse.json({ error: d["api.order.createFailed"] }, { status: 400 });
    }

    const acct = await db.query.users.findFirst({
      where: (u, { eq: eq2 }) => eq2(u.id, session.userId),
      columns: { emailVerified: true },
    });
    if (!acct?.emailVerified) {
      return NextResponse.json(
        { error: d["api.preview.emailNotVerified"], code: "email_not_verified" },
        { status: 403 },
      );
    }

    const [{ value: jobCount }] = await db
      .select({ value: count() })
      .from(creativeLabJobs)
      .where(eq(creativeLabJobs.userId, session.userId));
    if (jobCount >= CREATIVE_LAB_ACCOUNT_CAP) {
      return NextResponse.json(
        { error: d["api.preview.limitReached"], code: "account_cap" },
        { status: 429 },
      );
    }

    const photoUrl = getPublicUrl(photoKey);
    const [jobRow] = await db
      .insert(creativeLabJobs)
      .values({ userId: session.userId, product: prod, photoKey, photoUrl, status: "generating" })
      .returning();

    await getCreativeLabQueue().add("generate", {
      jobId: jobRow.id,
      product: prod,
      photoKey,
      imageUrl: photoUrl,
    });

    return NextResponse.json({ jobId: jobRow.id });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json(
        { error: (error as Error & { errors?: unknown }).errors },
        { status: 400 },
      );
    }
    console.error("Creative Lab generate failed:", error);
    return NextResponse.json({ error: d["api.order.createFailed"] }, { status: 500 });
  }
}
