export async function register() {
  // Sentry server/edge initialisation (no-op without NEXT_PUBLIC_SENTRY_DSN).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Warm up the background removal model at server start
    // so the first request doesn't pay the loading cost
    import("@/lib/services/background-removal").then(async ({ ensureModel }) => {
      try {
        await ensureModel();
        console.log("Background removal model warmed up");
      } catch (err) {
        console.warn("Background removal model warmup failed:", err);
      }
    });
  }
}

// Pipes App Router nested-server-component + route-handler errors into Sentry.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
