import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { sseResponse } from "@/lib/realtime/sse-response";
import { topics } from "@/lib/realtime/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getManufacturerSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  return sseResponse(req, [topics.manufacturer(session.manufacturerId)]);
}
