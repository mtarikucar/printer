import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { readDisputeDecisionView, resolveDispute } from "@/lib/services/dispute-resolution";
import { DisputePolicyError, normalizeResolveDisputeInput } from "@/lib/config/dispute-resolution";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };
const validId = (id: string) => id.length === 36 && UUID.test(id);

/** A missing financial preview disables optional money, not the decision. */
export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!validId(id)) return NextResponse.json({ error: "Anlaşmazlık bulunamadı.", code: "not_found" }, { status: 404 });
    const result = await readDisputeDecisionView(id.toLowerCase());
    return NextResponse.json(result, {
      status: "dispute" in result ? 200 : result.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof DisputePolicyError) return NextResponse.json({ error: `Anlaşmazlık okunamadı: ${error.message}`, code: error.code }, { status: error.status });
    return handleRouteFailure(error, "GET /api/admin/disputes/[id]/resolve", ADMIN_READ_FAILED_ERROR);
  }
}

/** The service commits the decision and any actual refund as one operation. */
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;
    if (!validId(id)) return NextResponse.json({ error: "Anlaşmazlık bulunamadı.", code: "not_found" }, { status: 404 });
    const input = normalizeResolveDisputeInput(await request.json().catch(() => null));
    if (input.disputeId !== id.toLowerCase()) return NextResponse.json({
      error: "Karar, açık olan anlaşmazlık kaydına ait olmalıdır.", code: "invalid_evidence",
    }, { status: 400 });
    const result = await resolveDispute(input, { adminEmail: a.session.user.email });
    return NextResponse.json(result, { status: result.ok ? 200 : result.status });
  } catch (error) {
    if (error instanceof DisputePolicyError) return NextResponse.json({ error: `Anlaşmazlık kararı kaydedilemedi: ${error.message}`, code: error.code }, { status: error.status });
    return handleRouteFailure(error, "POST /api/admin/disputes/[id]/resolve", ADMIN_ACTION_FAILED_ERROR);
  }
}
