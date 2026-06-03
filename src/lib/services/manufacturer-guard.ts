import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";

/**
 * Guard for seller-only surfaces (product management): requires an
 * authenticated manufacturer whose account is `active` (KYC complete). Returns
 * the manufacturerId on success, or an {error,status} the caller turns into a
 * NextResponse. Mirrors the inline guard used in the manufacturer order routes.
 */
export async function requireActiveSeller(): Promise<
  | { manufacturerId: string }
  | { error: string; status: 401 | 403 }
> {
  const session = await getManufacturerSession();
  if (!session) return { error: "Unauthorized", status: 401 };
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return { error: "Your account is not active", status: 403 };
  }
  return { manufacturerId: session.manufacturerId };
}
