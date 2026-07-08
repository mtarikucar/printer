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
      maxConcurrentOrders: painters.maxConcurrentOrders,
      capabilities: painters.capabilities,
    })
    .from(painters)
    .where(and(eq(painters.status, "active"), eq(painters.acceptingOrders, true)));

  return NextResponse.json({
    painters: rows.map((p) => ({
      id: p.id,
      companyName: p.companyName,
      il: (p.city as { il?: string } | null)?.il ?? null,
      capabilities: p.capabilities ?? [],
    })),
  });
}
