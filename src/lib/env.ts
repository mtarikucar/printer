/**
 * Centralised, fail-fast env access. Importing this module at server startup
 * surfaces missing / malformed env vars immediately instead of later — at the
 * exact moment a JWT is signed with `undefined`, a webhook fires, etc.
 *
 * Imported at the top of `src/middleware.ts` so server boot fails on missing
 * critical env in production. In dev (NODE_ENV !== "production") we log a
 * warning instead of throwing so local setups can run without every var set.
 *
 * IMPORTANT: `next build` runs with NODE_ENV="production" but does not have
 * runtime secrets (AUTH_SECRET etc.) injected. We detect the build phase via
 * NEXT_PHASE and suppress throws then — the same check still fires at boot
 * (phase-production-server) and at runtime.
 */

function isProductionRuntime(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  // Skip during build / static export — secrets aren't supposed to be present.
  const phase = process.env.NEXT_PHASE;
  if (phase === "phase-production-build" || phase === "phase-export") return false;
  return true;
}

function required(name: string, opts?: { minLength?: number }): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    const msg = `Missing required env var: ${name}`;
    if (isProductionRuntime()) {
      throw new Error(msg);
    }
    // During build (or dev) we degrade gracefully so the bundler can still
    // resolve this module.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[env] ${msg} — set in .env before going to production`);
    }
    return "";
  }
  if (opts?.minLength && v.length < opts.minLength) {
    const msg = `Env ${name} is too short (need ≥${opts.minLength} chars)`;
    if (isProductionRuntime()) {
      throw new Error(msg);
    }
    console.warn(`[env] ${msg}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") return fallback;
  return v;
}

/**
 * AUTH_SECRET is the base secret. Customer + manufacturer realms can override
 * with their own secrets so a leak in one doesn't compromise the other. In dev,
 * all three default to AUTH_SECRET.
 */
const AUTH_SECRET = required("AUTH_SECRET", { minLength: 32 });
const CUSTOMER_JWT_SECRET = optional("CUSTOMER_JWT_SECRET", AUTH_SECRET);
const MANUFACTURER_JWT_SECRET = optional("MANUFACTURER_JWT_SECRET", AUTH_SECRET);
const PAINTER_JWT_SECRET = optional("PAINTER_JWT_SECRET", AUTH_SECRET);

// Warn whenever any pair of secrets is identical — not only the fall-back case.
// An operator who set CUSTOMER_JWT_SECRET to the same value as AUTH_SECRET
// (or as MANUFACTURER_JWT_SECRET) gets the same cross-realm exposure as if
// they left it unset. Skipped during build (no secrets available).
if (isProductionRuntime()) {
  const pairs: Array<[string, string, string, string]> = [
    ["AUTH_SECRET", AUTH_SECRET, "CUSTOMER_JWT_SECRET", CUSTOMER_JWT_SECRET],
    ["AUTH_SECRET", AUTH_SECRET, "MANUFACTURER_JWT_SECRET", MANUFACTURER_JWT_SECRET],
    [
      "CUSTOMER_JWT_SECRET",
      CUSTOMER_JWT_SECRET,
      "MANUFACTURER_JWT_SECRET",
      MANUFACTURER_JWT_SECRET,
    ],
  ];
  for (const [aName, aVal, bName, bVal] of pairs) {
    if (aVal && aVal === bVal) {
      console.warn(
        `[env] ${aName} and ${bName} share the same value. A leak in either realm compromises both — set distinct secrets.`
      );
    }
  }
}

export const env = {
  AUTH_SECRET,
  CUSTOMER_JWT_SECRET,
  MANUFACTURER_JWT_SECRET,
  PAINTER_JWT_SECRET,

  ADMIN_EMAIL: required("ADMIN_EMAIL"),

  // Never fall back to localhost in production — email links and payment
  // redirects are built on this. Prefer the canonical domain if the env var is
  // somehow unset on a prod box; only dev/build fall back to localhost.
  APP_URL: optional(
    "NEXT_PUBLIC_APP_URL",
    process.env.NODE_ENV === "production"
      ? "https://figurunica.com"
      : "http://localhost:3000"
  ),

  TRUSTED_PROXY_IPS: optional("TRUSTED_PROXY_IPS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

/**
 * Issuer / audience claims for our JWTs. Keeping each realm distinct prevents
 * cross-realm token confusion even if secrets are mis-configured.
 */
export const JWT_CLAIMS = {
  customer: { iss: "figurunica.customer", aud: "figurunica.customer-api" },
  manufacturer: {
    iss: "figurunica.manufacturer",
    aud: "figurunica.manufacturer-api",
  },
  painter: {
    iss: "figurunica.painter",
    aud: "figurunica.painter-api",
  },
} as const;
