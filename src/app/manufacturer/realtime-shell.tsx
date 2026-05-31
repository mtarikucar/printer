"use client";

import type { ReactNode } from "react";
import { RealtimeProvider } from "@/lib/realtime/provider";
import { RealtimeRefresher } from "@/lib/realtime/refresher";

/**
 * Wraps the authenticated manufacturer panel in a single SSE connection scoped
 * to this manufacturer. Order events (new assignments, QC results, status
 * changes on their orders) re-pull server data via router.refresh(); chat
 * messages are handled locally by the OrderChat hook.
 */
export function ManufacturerRealtimeShell({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider url="/api/realtime/manufacturer">
      <RealtimeRefresher match={(e) => e.kind === "order"} />
      {children}
    </RealtimeProvider>
  );
}
