import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { previews, users } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getSessionUser } from "@/lib/services/customer-auth";
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
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: d["api.auth.required"] }, { status: 401 });
    }

    const body = await request.json();
    const validated = revisionSchema.parse(body);

    const preview = await db.query.previews.findFirst({
      where: and(eq(previews.id, id), eq(previews.userId, session.userId)),
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

    // Get user info for email
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });

    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail && user) {
      await getEmailQueue().add("revision-request", {
        type: "revision_request",
        to: user.email,
        orderNumber: "",
        customerName: user.fullName,
        adminEmail,
        photoUrl: preview.photoUrl,
        glbUrl: preview.glbUrl || undefined,
        revisionNote: validated.note,
        locale,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error("Revision request failed:", error);
    return NextResponse.json(
      { error: d["common.error"] },
      { status: 500 }
    );
  }
}
