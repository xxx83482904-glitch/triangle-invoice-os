import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "tesseract.js"],
  outputFileTracingIncludes: {
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
