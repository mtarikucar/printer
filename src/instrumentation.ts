export async function register() {
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
