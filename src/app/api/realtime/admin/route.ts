import { auth } from "@/lib/auth/config";
import { sseResponse } from "@/lib/realtime/sse-response";
import { topics } from "@/lib/realtime/events";

// Node runtime (ioredis) + never static so the stream stays open per-request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if ((session?.user as { role?: string } | undefined)?.role !== "admin") {
    return new Response("Unauthorized", { status: 401 });
  }
  return sseResponse(req, [topics.admin()]);
}
