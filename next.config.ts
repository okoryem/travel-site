import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a fully static site into out/. No Node server runs in production —
  // S3 holds the files, CloudFront serves them. See docs/DECISIONS.md ADR-003.
  output: "export",

  // Static export has no server, so next/image's on-demand optimizer can't run.
  // Poster frames are pre-optimized at build time instead (see CONTENT-MODEL.md).
  images: { unoptimized: true },

  // Emit /clips/hanoi/index.html rather than /clips/hanoi.html.
  // Directory-style paths are what CloudFront + S3 resolve predictably.
  trailingSlash: true,
};

export default nextConfig;
