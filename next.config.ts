import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Builds .next/standalone, which is what the Dockerfile runtime stage copies.
  output: "standalone",
  // Lets a phone or tablet on the LAN reach the dev server. Without it Next 16
  // blocks the cross-origin HMR connection, and the page renders but never
  // hydrates, so no control responds.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
