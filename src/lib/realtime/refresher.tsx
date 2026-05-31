"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useRealtimeEvent } from "./use-realtime";
import type { RealtimeEvent } from "./events";

/**
 * Drop-in for RSC-backed surfaces (sidebar badges, server-rendered lists):
 * calls router.refresh() — which re-runs the server components and re-pulls
 * their data — whenever a matching realtime event arrives. Bursts are coalesced
 * into a single refresh so a flurry of events doesn't hammer the server.
 *
 * Renders nothing; mount it anywhere inside a RealtimeProvider.
 */
export function RealtimeRefresher({
  match,
}: {
  match?: (e: RealtimeEvent) => boolean;
}) {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useRealtimeEvent((e) => {
    if (match && !match(e)) return;
    if (pending.current) return; // already a refresh queued — coalesce
    pending.current = setTimeout(() => {
      pending.current = null;
      router.refresh();
    }, 400);
  });

  return null;
}
