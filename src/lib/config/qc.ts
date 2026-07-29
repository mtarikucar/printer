/**
 * Quality-control constants shared by the manufacturer panel and the API.
 *
 * Kept in sync with the manufacturer partnership contract
 * (src/lib/content/manufacturer-onboarding.ts, §5): each QC round needs at
 * least four photos — overall front, back/side, a close-up of the finest
 * detail, and one with a ruler for scale.
 */
export const QC_MIN_PHOTOS = 4;
export const QC_MAX_PHOTOS = 6;
