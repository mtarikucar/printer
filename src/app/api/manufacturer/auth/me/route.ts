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
      status: manufacturer.status,
      createdAt: manufacturer.createdAt,
    },
  });
}
