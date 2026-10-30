import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return ["/design-fee-calculator", "/design-fee-calculator/index.html"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
    }));
  },
  async redirects() {
    return [{ source: "/design-fee-calculator", destination: "/design-fee-calculator/index.html", permanent: false }];
  },
  serverExternalPackages: ["pdfkit", "pdf-parse", "@napi-rs/canvas", "tesseract.js"],
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
