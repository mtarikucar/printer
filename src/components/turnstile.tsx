"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
  useId,
} from "react";
import Script from "next/script";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: Record<string, unknown>
      ) => string;
      execute: (container: string | HTMLElement, options?: Record<string, unknown>) => void;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

export interface TurnstileRef {
  getToken: () => Promise<string>;
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export const Turnstile = forwardRef<TurnstileRef>(function Turnstile(_, ref) {
  const containerId = useId().replace(/:/g, "_");
  const widgetIdRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const pendingResolveRef = useRef<((token: string) => void) | null>(null);

  const handleLoad = useCallback(() => {
    if (!window.turnstile || readyRef.current) return;
    readyRef.current = true;

    widgetIdRef.current = window.turnstile.render(
      `turnstile_${containerId}`,
      {
        sitekey: SITE_KEY,
        execution: "execute",
        appearance: "interaction-only",
        callback: (token: string) => {
          if (pendingResolveRef.current) {
            pendingResolveRef.current(token);
            pendingResolveRef.current = null;
          }
        },
      }
    );
  }, [containerId]);

  useImperativeHandle(
    ref,
    () => ({
      getToken: () => {
        // If no site key configured, return empty string (dev bypass)
        if (!SITE_KEY) return Promise.resolve("");

        return new Promise<string>((resolve) => {
          const tryExecute = () => {
            if (!window.turnstile || !widgetIdRef.current) {
              // Widget not ready yet, retry shortly
              setTimeout(tryExecute, 100);
              return;
            }
            pendingResolveRef.current = resolve;
            window.turnstile.reset(widgetIdRef.current);
            window.turnstile.execute(`turnstile_${containerId}`);
          };
          tryExecute();
        });
      },
    }),
    [containerId]
  );

  if (!SITE_KEY) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad"
        strategy="afterInteractive"
        onReady={() => {
          window.onTurnstileLoad = handleLoad;
          // If turnstile already loaded before onReady
          if (window.turnstile) handleLoad();
        }}
      />
      <div
        id={`turnstile_${containerId}`}
        style={{ position: "fixed", bottom: 0, left: 0, zIndex: -1 }}
      />
    </>
  );
});
