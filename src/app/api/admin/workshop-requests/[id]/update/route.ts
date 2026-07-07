import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { workshopRequests } from "@/lib/db/schema";
import { WORKSHOP_STATUS_VALUES } from "@/lib/workshop/constants";
import { sendWorkshopStatusEmail } from "@/lib/services/workshop-notify";

// Statuses whose transition triggers a customer-facing email.
const EMAILED_STATUSES = new Set(["scheduled", "rejected", "completed"]);

const schema = z
  .object({
    status: z.enum(WORKSHOP_STATUS_VALUES).optional(),
    adminNotes: z.string().trim().max(4000).optional(),
    rejectionReason: z.string().trim().max(2000).optional(),
    // Price entered by admin, already converted to kuruş by the client.
    quotedPriceKurus: z.coerce
      .number()
      .int()
      .min(0)
      .max(1_000_000_00)
      .nullable()
      .optional(),
    // YYYY-MM-DD (or ISO). Empty string / null clears it.
    scheduledAt: z.string().max(40).nullable().optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.adminNotes !== undefined ||
      v.rejectionReason !== undefined ||
      v.quotedPriceKurus !== undefined ||
      v.scheduledAt !== undefined,
    { message: "Güncellenecek alan yok" }
  );

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const existing = await db.query.workshopRequests.findFirst({
    where: eq(workshopRequests.id, id),
    columns: { id: true, status: true, scheduledAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Talep bulunamadı" }, { status: 404 });
  }

  // Build the update set only from the fields the admin actually sent.
  const set: Partial<typeof workshopRequests.$inferInsert> = {
    updatedAt: new Date(),
    adminEmail: a.session.user.email,
  };
  if (data.adminNotes !== undefined) set.adminNotes = data.adminNotes || null;
  if (data.rejectionReason !== undefined)
    set.rejectionReason = data.rejectionReason || null;
  if (data.quotedPriceKurus !== undefined)
    set.quotedPriceKurus = data.quotedPriceKurus;
  if (data.scheduledAt !== undefined) {
    if (data.scheduledAt) {
      const d = new Date(data.scheduledAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Geçersiz tarih" }, { status: 400 });
      }
      set.scheduledAt = d;
    } else {
      set.scheduledAt = null;
    }
  }
  if (data.status !== undefined) set.status = data.status;

  const [updated] = await db
    .update(workshopRequests)
    .set(set)
    .where(eq(workshopRequests.id, id))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "Güncellenemedi" }, { status: 400 });
  }

  // Email the requester when the request actually TRANSITIONS into an emailed
  // state (Planla → scheduled / Reddet → rejected / Tamamlandı → completed),
  // OR when an already-scheduled request's date is edited (re-notify the new
  // date). Gating on change prevents duplicate emails from habitual re-clicks
  // of the same status button — those buttons stay enabled after the
  // router.refresh, so a second click would otherwise re-send. Non-fatal.
  if (data.status !== undefined && EMAILED_STATUSES.has(data.status)) {
    const statusChanged = data.status !== existing.status;
    const rescheduled =
      data.status === "scheduled" &&
      +new Date(updated.scheduledAt ?? 0) !== +new Date(existing.scheduledAt ?? 0);
    if (statusChanged || rescheduled) {
      await sendWorkshopStatusEmail(updated, data.status).catch((e) =>
        console.error("workshop status email failed (non-fatal)", e)
      );
    }
  }

  return NextResponse.json({ success: true });
}
