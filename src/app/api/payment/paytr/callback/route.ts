/**
 * Defensive alias for the PayTR webhook handler.
 *
 * The canonical path is `/api/webhooks/paytr` (see ../../../webhooks/paytr/route.ts)
 * and the prod PayTR merchant panel already points there. This alias exists
 * purely as defense-in-depth so that:
 *   - any historical webhook retry that PayTR still has queued against the
 *     legacy `/api/payment/paytr/callback` path is captured (not lost to 404)
 *   - a future panel mis-edit to this path doesn't silently break payments
 *
 * It is NOT a sign of misconfiguration — both paths legitimately resolve to
 * the same handler.
 *
 * Written as an explicit handler (instead of `export { POST } from ...`)
 * because Next.js's generated route validator types-check the file in
 * isolation, and re-export forms occasionally trip its strict route
 * signature validation.
 */
import type { NextRequest } from "next/server";
import { POST as canonicalPOST } from "../../../webhooks/paytr/route";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return canonicalPOST(request);
}
