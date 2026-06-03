import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNotNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { sendEmail } from "@/lib/services/email";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const [m] = await db
    .update(manufacturers)
    .set({ status: "active", updatedAt: new Date() })
    .where(
      and(
        eq(manufacturers.id, id),
        eq(manufacturers.status, "conditionally_approved"),
        isNotNull(manufacturers.printerPhotoUploadedAt)
      )
    )
    .returning();

  if (!m) {
    return NextResponse.json(
      { error: "Manufacturer must be conditionally approved with an uploaded printer photo" },
      { status: 400 }
    );
  }

  await publishRealtime([topics.admin()], { kind: "badge" });

  try {
    await sendEmail({
      type: "manufacturer_approved",
      to: m.email,
      manufacturerEmail: m.email,
      companyName: m.companyName,
      orderNumber: "",
      customerName: m.contactPerson,
    });
  } catch (err) {
    console.error("manufacturer_approved email failed:", err);
  }

  return NextResponse.json({ success: true });
}
