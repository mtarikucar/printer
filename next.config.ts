import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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
      // Trademark cleanup: the "disney" style slug was renamed to "storybook".
      {
        source: "/styles/disney",
        destination: "/styles/storybook",
        permanent: true,
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
      silent: !process.env.CI,
      // Upload source maps only when we have an auth token.
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
      widenClientFileUpload: true,
      disableLogger: true,
      // Tunnel browser events through our own domain to dodge ad blockers.
      tunnelRoute: "/monitoring",
    })
  : nextConfig;
