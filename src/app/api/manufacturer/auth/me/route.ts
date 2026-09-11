import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";

export async function GET() {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json(
      { error: "Not logged in" },
      { status: 401 }
    );
  }

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });

  if (!manufacturer) {
    return NextResponse.json(
      { error: "Manufacturer not found" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    manufacturer: {
      id: manufacturer.id,
      email: manufacturer.email,
      companyName: manufacturer.companyName,
      contactPerson: manufacturer.contactPerson,
      phone: manufacturer.phone,
      whatsappPhone: manufacturer.whatsappPhone,
      address: manufacturer.address,
      taxId: manufacturer.taxId,
      taxIdType: manufacturer.taxIdType,
      requiresManualTaxReview: manufacturer.requiresManualTaxReview,
      iban: manufacturer.iban,
      bankAccountHolder: manufacturer.bankAccountHolder,
      bankName: manufacturer.bankName,
      // An IBAN change parked for admin review. The profile page shows it, so
      // a partner who just submitted one does not see only the old IBAN and
      // assume the save failed. Same fields as the painter /me.
      pendingIban: manufacturer.pendingIban,
      ibanReviewStatus: manufacturer.ibanReviewStatus,
      maxConcurrentOrders: manufacturer.maxConcurrentOrders,
      acceptingOrders: manufacturer.acceptingOrders,
      paintsInHouse: manufacturer.paintsInHouse,
      capabilities: manufacturer.capabilities,
      onboardingAcceptedAt: manufacturer.onboardingAcceptedAt,
      status: manufacturer.status,
      printerPhotoUploadedAt: manufacturer.printerPhotoUploadedAt,
      createdAt: manufacturer.createdAt,
    },
  });
}
