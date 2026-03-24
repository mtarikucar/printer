import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { hostname: "localhost" },
      { hostname: "127.0.0.1" },
    ],
  },
  serverExternalPackages: ["bullmq", "ioredis", "onnxruntime-node", "sharp"],
  // Turbopack handles node module resolution automatically — empty config silences the warning
  turbopack: {},
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

export default nextConfig;
