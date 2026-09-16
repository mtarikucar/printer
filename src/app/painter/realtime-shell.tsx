"use client";

import type { ReactNode } from "react";
import { RealtimeProvider } from "@/lib/realtime/provider";
import { RealtimeRefresher } from "@/lib/realtime/refresher";

/**
 * Wraps the authenticated painter panel in a single SSE connection scoped to
 * this painter — the manufacturer shell's twin. Order events (a new job, a QC
 * result, a NEW MODEL REVISION, an admin painter swap) re-pull the server-
 * rendered job list via router.refresh().
 */
export function PainterRealtimeShell({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider url="/api/realtime/painter">
      {/* Sipariş olayları sunucudan gelen veriyi yeniden çeker (kenar çubuğu
          rozeti, iş listesi). Mesaj olaylarını sohbet bileşeni kendi
          aboneliğiyle karşılar. */}
      <RealtimeRefresher match={(e) => e.kind === "order"} />
      {children}
    </RealtimeProvider>
  );
}
