// Sentry initialisation for the standalone BullMQ worker process.
//
// This is NOT covered by sentry.server.config.ts: that one is loaded by
// Next.js through instrumentation.ts, and `workers/start.ts` is a plain Node
// process that never goes through Next. Until this existed, a job that threw
// at 03:00 produced nothing but an ephemeral container log line.
//
// Uses @sentry/node rather than @sentry/nextjs — there is no Next runtime here.
import * as Sentry from "@sentry/node";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    // Order payloads and customer PII must not leave the box.
    sendDefaultPii: false,
    enabled: process.env.NODE_ENV === "production",
    initialScope: { tags: { process: "worker" } },
  });
  console.log("[sentry] worker error reporting enabled");
} else {
  console.log("[sentry] NEXT_PUBLIC_SENTRY_DSN unset; worker errors are log-only");
}

export { Sentry };
