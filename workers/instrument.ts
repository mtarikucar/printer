// Must be the FIRST import in workers/start.ts so Sentry patches the runtime
// before any worker module is loaded.
import "../sentry.worker.config";
