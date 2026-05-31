import IORedis from "ioredis";
import { getRedisConnection } from "@/lib/queue/connection";
import {
  REDIS_REALTIME_CHANNEL,
  type RealtimeEnvelope,
  type RealtimeEvent,
} from "./events";

/**
 * Publish a realtime event to every web instance via Redis pub/sub.
 *
 * Safe to call from ANY process — web route handlers AND the BullMQ worker
 * process — because both share REDIS_URL. This is the bridge that lets a
 * worker-driven status change (e.g. AI generation finishing) reach the web
 * tier that holds the open SSE connections.
 *
 * Best-effort: realtime is an enhancement, so a publish failure is logged but
 * never propagated to the caller's mutation path.
 */
export async function publishRealtime(
  topicList: string[],
  event: RealtimeEvent
): Promise<void> {
  if (topicList.length === 0) return;
  const envelope: RealtimeEnvelope = { topics: topicList, event };
  try {
    await getRedisConnection().publish(
      REDIS_REALTIME_CHANNEL,
      JSON.stringify(envelope)
    );
  } catch (err) {
    console.error("[realtime] publish failed:", (err as Error)?.message);
  }
}

// A DEDICATED subscriber connection. An ioredis client in "subscriber mode"
// cannot issue normal commands, so this MUST be separate from the shared
// command connection returned by getRedisConnection().
let subscriber: IORedis | null = null;
export function getRealtimeSubscriber(): IORedis {
  if (!subscriber) {
    subscriber = new IORedis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return subscriber;
}
