import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { manufacturers, orders, painters } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";

const orderIdSchema = z.string().uuid();

// List painters a manufacturer can hand a painting job to: active + accepting.
// Used to populate the "Boyacıya gönder" picker on the manufacturer order page.
//
// With `?orderId=` each painter also carries `declined`: true when they already
// refused THIS job (orders.declinedPainterIds). The picker greys them out and
// send-to-painter refuses them, instead of the manufacturer finding out from a
// 409. Only the manufacturer's own order is read; any other id marks nobody.
export async function GET(request: NextRequest) {
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

  let declined = new Set<string>();
  // Validated first: a non-uuid compared with a uuid column is a Postgres
  // error, which would turn a bad query string into a 500.
  const orderId = orderIdSchema.safeParse(request.nextUrl.searchParams.get("orderId"));
  if (orderId.success) {
    const order = await db.query.orders.findFirst({
      where: and(
        eq(orders.id, orderId.data),
        eq(orders.manufacturerId, session.manufacturerId)
      ),
      columns: { declinedPainterIds: true },
    });
    const ids = order?.declinedPainterIds;
    if (Array.isArray(ids)) declined = new Set(ids);
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
        declined: declined.has(p.id),
      };
    }),
  });
}
