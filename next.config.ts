import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Report-only CSP source allowlist. Covers: self, inline scripts/styles (next +
// our consent bootstrap), Google Fonts, Cloudflare Turnstile, GTM/GA4, Meta
// pixel + CAPI, TikTok pixel + Events API, PayTR checkout iframe and Sentry.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net https://analytics.tiktok.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  [
    "connect-src 'self'",
    "https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com",
    "https://www.googletagmanager.com",
    "https://graph.facebook.com https://connect.facebook.net",
    "https://business-api.tiktok.com https://analytics.tiktok.com",
    "https://*.ingest.sentry.io https://*.sentry.io",
  ].join(" "),
  "frame-src 'self' https://challenges.cloudflare.com https://www.googletagmanager.com https://www.paytr.com https://*.paytr.com",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { hostname: "localhost" },
      { hostname: "127.0.0.1" },
      { hostname: "figurunica.com" },
      { hostname: "www.figurunica.com" },
    ],
  },
  serverExternalPackages: ["bullmq", "ioredis", "onnxruntime-node", "sharp"],
  // Turbopack handles node module resolution automatically — empty config silences the warning
  turbopack: {},
  async redirects() {
    return [
      // Gallery queue list folded into /admin/gallery?tab=queue (the [id] detail
      // route is unaffected — this exact source does not match nested paths).
      {
        source: "/admin/gallery-queue",
        destination: "/admin/gallery?tab=queue",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Content-Security-Policy in REPORT-ONLY mode: it allowlists every
          // domain the analytics/ad/error stack talks to but does NOT block
          // anything, so it can't break the site. Watch the browser console /
          // wire a report-uri, then promote to an enforcing
          // `Content-Security-Policy` header once violations are clean.
          {
            key: "Content-Security-Policy-Report-Only",
            value: CSP_REPORT_ONLY,
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // @huggingface/transformers uses ONNX runtime which needs these fallbacks
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
};

// Wrap with the Sentry build plugin only when a DSN is configured, so builds
// without Sentry (CI, local, pre-launch) are completely unaffected. Source-map
// upload additionally requires SENTRY_AUTH_TOKEN + org/project.
const sentryEnabled = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN?.trim());

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Org region for source-map upload (EU org → https://de.sentry.io/).
      // Unset falls back to the US host; harmless when no auth token.
      ...(process.env.SENTRY_URL ? { sentryUrl: process.env.SENTRY_URL } : {}),
      silent: !process.env.CI,
      // Upload source maps only when we have an auth token.
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
      widenClientFileUpload: true,
      disableLogger: true,
      // Tunnel browser events through our own domain to dodge ad blockers.
      tunnelRoute: "/monitoring",
    })
  : nextConfig;
