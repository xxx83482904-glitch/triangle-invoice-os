import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    ...(dev ? {} : { output: "export" }),
    trailingSlash: true,
    skipTrailingSlashRedirect: true,
    poweredByHeader: false,
    devIndicators: false,
    turbopack: { root: __dirname },
    ...(dev ? { async rewrites() { return [
      { source: "/api/:path*", destination: "http://127.0.0.1:8765/api/:path*" },
      { source: "/ws", destination: "http://127.0.0.1:8765/ws" },
    ]; } } : {}),
  };
}
