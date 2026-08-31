import { NextResponse } from "next/server";
import { getIndexNowKey } from "@/lib/services/indexnow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * IndexNow key file.
 *
 * The spec's default is `https://host/<key>.txt`, which would need a catch-all
 * route. It also allows any location as long as the submission names it in
 * `keyLocation`, which is what we do — one fixed path, no routing gymnastics.
 *
 * 404 when unconfigured: serving an empty body would make the key look valid
 * and get submissions rejected with no obvious cause.
 */
export async function GET() {
  const key = getIndexNowKey();
  if (!key) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(key, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
