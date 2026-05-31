import { getHub, type RealtimeClient } from "./hub";
import type { RealtimeEvent } from "./events";

const encoder = new TextEncoder();
// Heartbeat well under typical 30–60s idle proxy timeouts so the stream stays
// open through Railway / reverse proxies even when no events flow.
const HEARTBEAT_MS = 25_000;

/**
 * Build a long-lived Server-Sent Events response that forwards realtime events
 * for the given topics to the browser.
 *
 * Lifecycle is leak-safe: the client is registered with the hub on open and
 * unregistered on disconnect (request abort) or stream cancel, and the
 * heartbeat interval is always cleared.
 */
export function sseResponse(req: Request, subscribeTopics: string[]): Response {
  const hub = getHub();
  let client: RealtimeClient | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (client) {
      hub.unregister(client);
      client = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* controller already closed */
        }
      };

      client = {
        topics: new Set(subscribeTopics),
        send: (event: RealtimeEvent) =>
          safeEnqueue(`data: ${JSON.stringify(event)}\n\n`),
      };
      hub.register(client);

      // Ask the browser to reconnect 5s after a drop, then open the stream.
      safeEnqueue(`retry: 5000\n\n`);
      safeEnqueue(`: connected\n\n`);

      heartbeat = setInterval(() => safeEnqueue(`: ping\n\n`), HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx / some PaaS) so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
