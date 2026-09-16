import { NextRequest, NextResponse } from "next/server";
import { decideModelApproval } from "@/lib/services/model-approval";
import { rateLimitAsync } from "@/lib/services/rate-limit";
import { getClientIpFromRequest } from "@/lib/utils/request";
import { handleRouteFailure, CUSTOMER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const DECISIONS = new Set(["approved", "revision", "cancelled"]);

/**
 * Record the customer's decision on the 3D model.
 *
 * Unauthenticated by design: the token IS the capability, exactly like
 * /pay/<reference> and /yolculuk/<token>. The transition is atomic on
 * `awaiting_customer_approval`, so a double tap or a retried request is a
 * friendly no-op rather than a second state change.
 */
async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const ip = getClientIpFromRequest(request);

  const limit = await rateLimitAsync(`onay:${token}:${ip}`, 10, 60 * 1000);
  if (!limit.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const decision = String(body?.decision ?? "");
  if (!DECISIONS.has(decision)) {
    return NextResponse.json({ error: "bad_decision" }, { status: 400 });
  }

  const note = typeof body?.note === "string" ? body.note.slice(0, 800) : undefined;

  const result = await decideModelApproval({
    token,
    decision: decision as "approved" | "revision" | "cancelled",
    note,
    ip,
    userAgent: request.headers.get("user-agent"),
  });

  // A bad token is indistinguishable from a made-up one.
  if (!result.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    success: true,
    status: result.status,
    alreadyDecided: result.alreadyDecided ?? false,
    // Approval and revision are refused on a refunded order and come back as
    // alreadyDecided. Without this flag the page could only thank the customer
    // for a decision that was never recorded.
    refunded: result.refunded ?? false,
  });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePOST` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    return await handlePOST(request, ctx);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/onay/[token]", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
