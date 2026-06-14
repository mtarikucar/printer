import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { previews, users } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getSessionUser } from "@/lib/services/customer-auth";
import { normalizeFileUrl } from "@/lib/services/storage";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const revisionSchema = z.object({
  note: z.string().min(1).max(1000),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const { id } = await params;

  try {
    const body = await request.json();
    const validated = revisionSchema.parse(body);

    // Preview ID is a UUID — unguessable, no auth required
    const preview = await db.query.previews.findFirst({
      where: eq(previews.id, id),
    });

    if (!preview) {
      return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
    }

    // Update preview status
    await db
      .update(previews)
      .set({
        status: "revision_requested",
        revisionNote: validated.note,
        updatedAt: new Date(),
      })
      .where(eq(previews.id, id));

    // Send email notification if user is known
    const session = await getSessionUser();
    const user = session
      ? await db.query.users.findFirst({ where: eq(users.id, session.userId) })
      : null;

    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail && user) {
      await getEmailQueue().add("revision-request", {
        type: "revision_request",
        to: user.email,
        orderNumber: "",
        customerName: user.fullName,
        adminEmail,
        // Re-sign at send time: the stored URLs carry a fixed-TTL signature
        // that can expire before the email is opened (and would 401 once
        // FILES_REQUIRE_SIGNATURE is on). normalizeFileUrl re-derives the key
        // and re-signs with a fresh exp.
        photoUrl: normalizeFileUrl(preview.photoUrl) ?? preview.photoUrl,
        glbUrl: normalizeFileUrl(preview.glbUrl) ?? undefined,
        revisionNote: validated.note,
        locale,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: (error as Error & { errors?: unknown }).errors }, { status: 400 });
    }
    console.error("Revision request failed:", error);
    return NextResponse.json(
      { error: d["common.error"] },
      { status: 500 }
    );
  }
}
