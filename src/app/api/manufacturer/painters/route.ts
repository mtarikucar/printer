import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, painters } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";

// List painters a manufacturer can hand a painting job to: active + accepting.
// Used to populate the "Boyacıya gönder" picker on the manufacturer order page.
export async function GET() {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Match every other manufacturer action route: a suspended/rejected account
  // holding a still-valid JWT must not read the painter directory.
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json({ error: "Your account is not active" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: painters.id,
      companyName: painters.companyName,
      city: painters.address,
      contactPerson: painters.contactPerson,
      phone: painters.phone,
      maxConcurrentOrders: painters.maxConcurrentOrders,
      capabilities: painters.capabilities,
    })
    .from(painters)
    .where(and(eq(painters.status, "active"), eq(painters.acceptingOrders, true)));

  return NextResponse.json({
    painters: rows.map((p) => {
      const addr = p.city as {
        adres?: string;
        mahalle?: string;
        ilce?: string;
        il?: string;
        postaKodu?: string;
      } | null;
      return {
        id: p.id,
        companyName: p.companyName,
        il: addr?.il ?? null,
        capabilities: p.capabilities ?? [],
        // The manufacturer physically ships the base print to the painter, so
        // they need the address and a phone for the courier — previously they
        // got only a company name and a city.
        contactPerson: p.contactPerson,
        phone: p.phone,
        address: addr
          ? {
              adres: addr.adres ?? "",
              mahalle: addr.mahalle ?? "",
              ilce: addr.ilce ?? "",
              il: addr.il ?? "",
              postaKodu: addr.postaKodu ?? "",
            }
          : null,
      };
    }),
  });
}
