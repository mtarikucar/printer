/**
 * "Does this order have a model?" and "which file IS its current model?" —
 * answered in ONE place.
 *
 * Why this exists: until multi-part uploads, every admin upload carried a GLB
 * (the route made it mandatory), so `order.modelGlbUrl` doubled as the "has a
 * model" flag, and `modelGlbUrl ?? generationAttempts[0].outputGlbUrl` only
 * ever fell through to the legacy auto-3D attempt on orders that never had an
 * upload. Now a revision may be STL-only (print parts) or GLB-only (preview),
 * and attachOrderModelFiles writes the kind a revision leaves out as NULL.
 * Keyed on the GLB alone, an STL-only order reads as "no model" (no journey
 * QR, "Eksik" on the workshop readiness card, no gallery publish), and the
 * attempt fallback resurrects a superseded generated mesh as if it were
 * current.
 *
 * Pure — no DB, no `server-only`: server components, routes and the BullMQ
 * worker (order-journey → email.worker) all reach it.
 */

/** The order columns that say whether the order carries a model of its own. */
export interface OrderOwnModelColumns {
  modelUploadedAt: Date | string | null;
  modelGlbKey: string | null;
  modelGlbUrl: string | null;
  modelStlKey: string | null;
  modelStlUrl: string | null;
}

/**
 * True when the order has a model revision of its OWN (admin upload or the
 * auto-3D attach), of any kind: GLB, STL or both.
 *
 * modelUploadedAt is stamped by every model write; the key/url columns are
 * checked as well so a row written without that stamp still counts.
 */
export function orderHasOwnModel(o: OrderOwnModelColumns): boolean {
  return !!(
    o.modelUploadedAt ||
    o.modelGlbKey ||
    o.modelGlbUrl ||
    o.modelStlKey ||
    o.modelStlUrl
  );
}

/** A legacy succeeded generation attempt, as consumers select it. */
export interface LegacyAttemptModel {
  outputGlbUrl?: string | null;
  outputStlUrl?: string | null;
}

/**
 * URL of the order's CURRENT model file of one kind, or null when the current
 * model has no file of that kind.
 *
 * The legacy generation attempt stands in ONLY for an order with no revision of
 * its own (historical Meshy orders, or an auto-3D order in the window between
 * the attempt succeeding and its model being attached). Once a revision exists,
 * a kind it does not carry means "not provided" — never "serve the old
 * generated mesh", which is exactly the model the revision was meant to replace.
 */
export function currentModelUrl(
  o: OrderOwnModelColumns,
  kind: "glb" | "stl",
  legacyAttempt: LegacyAttemptModel | null | undefined
): string | null {
  if (orderHasOwnModel(o)) {
    return (kind === "glb" ? o.modelGlbUrl : o.modelStlUrl) ?? null;
  }
  return (
    (kind === "glb" ? legacyAttempt?.outputGlbUrl : legacyAttempt?.outputStlUrl) ?? null
  );
}
