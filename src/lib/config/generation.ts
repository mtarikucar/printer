// Free AI-generation caps. Each Meshy/Tripo call costs money, so the free tier
// is bounded on three independent axes; a paid order exempts the account from
// all of them (paying customers are not the abuse target). Re-signing up with a
// fresh email on the same device/network is caught by the device + IP ceilings.
export const FREE_GENERATION_ACCOUNT_CAP = 3; // lifetime free generations per account
export const DEVICE_FREE_CAP = 5; // free generations per device cookie, per calendar month
export const IP_FREE_CAP = 10; // free generations per client IP, per calendar month

// Rolling window for the device/IP monthly buckets (keyed by YYYY-MM, so this
// is just the self-expiry TTL — a touch over a month).
export const FREE_GENERATION_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
