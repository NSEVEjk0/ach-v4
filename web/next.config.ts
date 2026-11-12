import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.ACH_BUILD_DIR ?? ".next",
  outputFileTracingRoot: __dirname,
  experimental: { cpus: 1 },
  async headers() { return [{source: '/:path*', headers: [
    {key: 'X-Content-Type-Options', value: 'nosniff'},
    {key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin'},
    {key: 'X-Frame-Options', value: 'DENY'},
    {key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"},
  ]}]; },
};
export default config;
