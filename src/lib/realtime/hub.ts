import { getRealtimeSubscriber } from "./bus";
import {
  REDIS_REALTIME_CHANNEL,
  type RealtimeEnvelope,
  type RealtimeEvent,
} from "./events";

export interface RealtimeClient {
  topics: Set<string>;
  send: (event: RealtimeEvent) => void;
}

interface Hub {
  clients: Set<RealtimeClient>;
  register: (c: RealtimeClient) => void;
  unregister: (c: RealtimeClient) => void;
}

// Process-global singleton. Stashed on globalThis so Next.js dev HMR doesn't
// spin up a second Redis subscriber + orphan the first on every hot reload.
const g = globalThis as unknown as { __rtHub?: Hub };

function createHub(): Hub {
  const clients = new Set<RealtimeClient>();

  // ONE subscriber connection per web process feeds ALL open SSE streams.
  const sub = getRealtimeSubscriber();
  sub
    .subscribe(REDIS_REALTIME_CHANNEL)
    .catch((err) =>
      console.error("[realtime] subscribe failed:", (err as Error)?.message)
    );

  sub.on("message", (_channel, payload) => {
    let env: RealtimeEnvelope;
    try {
      env = JSON.parse(payload);
    } catch {
      return;
    }
    const eventTopics = new Set(env.topics);
    for (const client of clients) {
      // Deliver when the client subscribes to ANY of the event's topics.
      for (const t of client.topics) {
        if (eventTopics.has(t)) {
          try {
            client.send(env.event);
          } catch {
            /* writer closed mid-dispatch — cleanup happens on abort */
          }
          break;
        }
      }
    }
  });

  return {
    clients,
    register: (c) => clients.add(c),
    unregister: (c) => clients.delete(c),
  };
}

export function getHub(): Hub {
  if (!g.__rtHub) g.__rtHub = createHub();
  return g.__rtHub;
}
