import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { sendEmail } from "@/lib/services/email";

const bodySchema = z.object({ reason: z.string().max(1000).optional() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  let reason: string | undefined;
  try {
    reason = bodySchema.parse(await request.json().catch(() => ({}))).reason;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const [m] = await db
    .update(manufacturers)
    .set({ status: "rejected", rejectionReason: reason ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(manufacturers.id, id),
        inArray(manufacturers.status, ["pending_approval", "conditionally_approved"])
      )
    )
    .returning();

  if (!m) {
    return NextResponse.json(
      { error: "Manufacturer not found or not in a rejectable state" },
      { status: 400 }
    );
  }

  await publishRealtime([topics.admin()], { kind: "badge" });

  try {
    await sendEmail({
      type: "manufacturer_rejected",
      to: m.email,
      manufacturerEmail: m.email,
      companyName: m.companyName,
      rejectionReason: reason,
      orderNumber: "",
      customerName: m.contactPerson,
    });
  } catch (err) {
    console.error("manufacturer_rejected email failed:", err);
  }

  return NextResponse.json({ success: true });
}
