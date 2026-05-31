import { getSessionUser } from "@/lib/services/customer-auth";
import { sseResponse } from "@/lib/realtime/sse-response";
import { topics } from "@/lib/realtime/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSessionUser();
  if (!session) return new Response("Unauthorized", { status: 401 });
  return sseResponse(req, [topics.customer(session.userId)]);
}
