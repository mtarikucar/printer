import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { markChannelRead } from "@/lib/services/order-chat";
import type { MessageChannel } from "@/lib/services/order-messages";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

function parseChannel(request: NextRequest): MessageChannel | null {
  const c = new URL(request.url).searchParams.get("channel");
  return c === "customer_admin" || c === "manufacturer_admin" ? c : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const channel = parseChannel(request);
    if (!channel) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    const { id } = await params;

    await markChannelRead(id, channel, "admin");
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/messages/read", ADMIN_ACTION_FAILED_ERROR);
  }
}
