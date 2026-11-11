import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.ACH_BUILD_DIR ?? ".next",
  outputFileTracingRoot: __dirname,
  experimental: { cpus: 1 },
};
export default config;
