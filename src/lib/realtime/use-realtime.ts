"use client";

import { useEffect, useRef } from "react";
import { useRealtimeContext } from "./provider";
import type { RealtimeEvent } from "./events";

/**
 * Subscribe to realtime events from the nearest RealtimeProvider. The handler
 * is called for every event — filter by `event.kind` (and orderId) inside it.
 *
 * The handler may be an inline closure: it is held in a ref so changing its
 * identity each render does NOT churn the subscription. No-ops safely when
 * rendered outside a provider (returns without subscribing), so polling-based
 * components can keep working as a fallback.
 */
export function useRealtimeEvent(handler: (e: RealtimeEvent) => void): void {
  const ctx = useRealtimeContext();
  const ref = useRef(handler);
  // Keep the ref pointing at the latest handler without re-subscribing. Updated
  // in an effect (not during render) so an inline closure is safe.
  useEffect(() => {
    ref.current = handler;
  });

  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe((e) => ref.current(e));
  }, [ctx]);
}
