import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { createPayoutForManufacturer } from "@/lib/services/payouts";

// Faz 6: a manufacturer requests payout of their pending earnings. Reuses the
// admin batching logic; the payout lands in the admin payouts queue to be paid.
export async function POST() {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { status: true },
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json({ error: "Account not active" }, { status: 403 });
  }

  const result = await createPayoutForManufacturer(
    session.manufacturerId,
    "manufacturer-request"
  );
  if (!result) {
    return NextResponse.json({ error: "nothing_owed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...result });
}
