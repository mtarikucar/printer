import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";

export async function GET() {
  const session = await getPainterSession();
  if (!session) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, session.painterId),
  });

  if (!painter) {
    return NextResponse.json({ error: "Painter not found" }, { status: 401 });
  }

  return NextResponse.json({
    painter: {
      id: painter.id,
      email: painter.email,
      companyName: painter.companyName,
      contactPerson: painter.contactPerson,
      phone: painter.phone,
      whatsappPhone: painter.whatsappPhone,
      address: painter.address,
      capabilities: painter.capabilities,
      taxId: painter.taxId,
      taxIdType: painter.taxIdType,
      requiresManualTaxReview: painter.requiresManualTaxReview,
      iban: painter.iban,
      bankAccountHolder: painter.bankAccountHolder,
      bankName: painter.bankName,
      maxConcurrentOrders: painter.maxConcurrentOrders,
      acceptingOrders: painter.acceptingOrders,
      onboardingAcceptedAt: painter.onboardingAcceptedAt,
      status: painter.status,
      rejectionReason: painter.rejectionReason,
      workSamplePhotoUploadedAt: painter.workSamplePhotoUploadedAt,
      strikeCount: painter.strikeCount,
      pendingIban: painter.pendingIban,
      ibanReviewStatus: painter.ibanReviewStatus,
      createdAt: painter.createdAt,
    },
  });
}
