"use client";

import type { ReactNode } from "react";
import { RealtimeProvider } from "@/lib/realtime/provider";
import { RealtimeRefresher } from "@/lib/realtime/refresher";

/**
 * Wraps the authenticated admin panel in a single SSE connection. Order/badge
 * events re-pull the server-rendered data (sidebar badges, order lists, queues,
 * dashboard) via router.refresh(); chat message events are handled locally by
 * the OrderChat hook, so they're not matched here.
 */
export function AdminRealtimeShell({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider url="/api/realtime/admin">
      <RealtimeRefresher
        match={(e) => e.kind === "order" || e.kind === "badge"}
      />
      {children}
    </RealtimeProvider>
  );
}
