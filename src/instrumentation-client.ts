// Sentry (browser) initialisation. Next.js auto-loads this on the client.
// No-op when NEXT_PUBLIC_SENTRY_DSN is unset.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1"
    ),
    // Session Replay is opt-in via env to keep payloads small by default.
    replaysSessionSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE ?? "0"
    ),
    replaysOnErrorSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE ?? "0"
    ),
    enabled: process.env.NODE_ENV === "production",
  });
}

// Capture client navigation transitions for tracing (guarded — the symbol only
// exists on newer SDKs).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
