import { sseResponse } from "@/lib/realtime/sse-response";
import { topics } from "@/lib/realtime/events";

// Public: the order-tracking page has no login. The stream is scoped to a
// single order number (a hard-to-guess identifier) and only carries that
// order's own status/message signals — no cross-order data.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const { orderNumber } = await params;
  return sseResponse(req, [topics.track(orderNumber)]);
}
