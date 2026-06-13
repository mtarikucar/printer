"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ConsentProvider } from "./consent-context";
import { AnalyticsScripts } from "./analytics-scripts";
import { CookieConsentBanner } from "./cookie-consent-banner";
import { track } from "@/lib/analytics/client";
import { hasAnyClientTag } from "@/lib/analytics/config";

/**
 * Single mount point for the whole browser analytics stack: consent state, the
 * tag loaders, automatic SPA page_view tracking and the consent banner. Safe to
 * always render — everything no-ops when no tag IDs are configured.
 */
export function Analytics() {
  return (
    <ConsentProvider>
      {hasAnyClientTag && (
        <>
          <AnalyticsScripts />
          <PageViewTracker />
        </>
      )}
      <CookieConsentBanner />
    </ConsentProvider>
  );
}

/**
 * Fires a `page_view` on initial load and on every client-side navigation.
 * Reads the query string from `window.location` (not useSearchParams) so the
 * root layout doesn't get forced into dynamic rendering / a Suspense boundary.
 */
function PageViewTracker() {
  const pathname = usePathname();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    const full = pathname + (typeof window !== "undefined" ? window.location.search : "");
    if (lastTracked.current === full) return; // guard double-fire in StrictMode
    lastTracked.current = full;
    track("page_view", { pagePath: full });
  }, [pathname]);

  return null;
}
