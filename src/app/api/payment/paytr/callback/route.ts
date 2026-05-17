/**
 * Backward-compat alias for the PayTR webhook handler.
 *
 * The canonical path is `/api/webhooks/paytr` (see ../../../webhooks/paytr/route.ts).
 * This route exists because the prod PayTR merchant panel was configured with
 * `/api/payment/paytr/callback` — that path never existed in the codebase, so
 * every webhook delivery 404'd and no card payment ever auto-promoted.
 *
 * Operators MUST update the panel to point at `/api/webhooks/paytr`. This file
 * stays around as defense-in-depth for any other PayTR account where the URL
 * was mis-configured.
 */
export { POST, runtime } from "../../../webhooks/paytr/route";
