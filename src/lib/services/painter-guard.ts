import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";

/**
 * Guard for painter-only surfaces: requires an authenticated painter whose
 * account is `active` (approved). Returns the painterId on success, or an
 * {error,status} the caller turns into a NextResponse. Mirrors
 * manufacturer-guard.ts / the inline guard used in manufacturer order routes.
 */
export async function requireActivePainter(): Promise<
  { painterId: string } | { error: string; status: 401 | 403 }
> {
  const session = await getPainterSession();
  if (!session) return { error: "Unauthorized", status: 401 };
  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, session.painterId),
  });
  if (!painter || painter.status !== "active") {
    return { error: "Your account is not active", status: 403 };
  }
  return { painterId: session.painterId };
}
