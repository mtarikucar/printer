import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { cancelWorkshopParticipant } from "@/lib/services/workshop-cancel";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/** Paid cancellation and the participant seat commit together; cash remains due. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; pid: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id, pid } = await params;
    const res = await cancelWorkshopParticipant({
      sessionId: id,
      participantId: pid,
      adminEmail: a.session.user.email,
    });

    if (!res.ok) {
      const status =
        res.reason === "not_found" ? 404 : res.reason === "already_shipped" || res.reason === "busy" ? 409 : 500;
      return NextResponse.json({ error: res.reason }, { status });
    }

    return NextResponse.json(res);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/workshops/sessions/[id]/participants/[pid]/cancel", ADMIN_ACTION_FAILED_ERROR);
  }
}
