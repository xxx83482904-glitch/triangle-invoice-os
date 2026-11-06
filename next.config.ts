import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

function buildSha(): string {
  let value = process.env.TRIANGLE_BUILD_SHA;
  if (value === undefined) {
    try {
      value = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3000,
        windowsHide: true,
      }).trim();
    } catch {
      // Docker builds may have neither git nor a .git directory.
      return "";
    }
  }
  return /^[0-9a-f]{40}$/.test(value) ? value : "";
}

const triangleBuildSha = buildSha();

const nextConfig: NextConfig = {
  output: "standalone",
  env: { TRIANGLE_BUILD_SHA: triangleBuildSha },
  async headers() {
    return [
      "/design-fee-calculator", "/design-fee-calculator/index.html",
      "/akira-kitchen", "/akira-kitchen/index.html",
      "/akira-kitchen/sw.js", "/akira-kitchen/manifest.webmanifest",
      "/akira-kitchen/release.json",
    ].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
    }));
  },
  async redirects() {
    return [
      { source: "/design-fee-calculator", destination: "/design-fee-calculator/index.html", permanent: false },
      { source: "/akira-kitchen", destination: "/akira-kitchen/index.html", permanent: false },
    ];
  },
  serverExternalPackages: ["pdfkit", "pdf-parse", "@napi-rs/canvas", "tesseract.js"],
  outputFileTracingExcludes: { "/*": ["./akira-kitchen/**/*"] },
  outputFileTracingIncludes: {
    "/api/section-export": ["./public/fonts/BIZUDMincho-Regular.ttf"],
    "/api/estimates/*/pdf": ["./public/fonts/BIZUDMincho-Regular.ttf"],
    "/api/issued-invoices/*/pdf": ["./public/fonts/BIZUDMincho-Regular.ttf"],
    "/api/uploads/**": [
      "./node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
  async rewrites() {
    return { beforeFiles: [{ source: "/uploads/received-invoices/:name", destination: "/api/files/:name" }] };
  },
};

export default nextConfig;
