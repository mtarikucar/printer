// Shared, isomorphic (client + server safe) realtime event + topic definitions.
// No Node imports here so this module can be bundled into client components.

export type RealtimeEvent =
  | {
      kind: "order";
      orderId: string;
      orderNumber: string;
      status?: string | null;
      manufacturerStatus?: string | null;
    }
  | { kind: "message"; orderId: string; channel: string; senderType: string }
  | { kind: "notification"; scope: "customer" | "manufacturer" }
  | { kind: "badge" };

// A connection subscribes to a SET of topics; an event is published with the
// list of topics it should reach. The hub delivers an event to a connection
// when their topic sets intersect.
export const topics = {
  order: (orderId: string) => `order:${orderId}`,
  admin: () => `admin`,
  manufacturer: (manufacturerId: string) => `manufacturer:${manufacturerId}`,
  customer: (userId: string) => `customer:${userId}`,
  track: (orderNumber: string) => `track:${orderNumber}`,
};

export interface RealtimeEnvelope {
  topics: string[];
  event: RealtimeEvent;
}

// Single Redis pub/sub channel that bridges every process (web instances +
// BullMQ worker) to the in-process SSE fan-out hubs.
export const REDIS_REALTIME_CHANNEL = "rt:events";
