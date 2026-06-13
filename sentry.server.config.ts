// Sentry (server runtime) initialisation. Loaded from instrumentation.ts when
// NEXT_RUNTIME === "nodejs". A no-op when NEXT_PUBLIC_SENTRY_DSN is unset, so it
// is safe to ship before the Sentry project exists.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    // PayTR/webhook payloads and customer PII shouldn't leave the box.
    sendDefaultPii: false,
    enabled: process.env.NODE_ENV === "production",
  });
}
