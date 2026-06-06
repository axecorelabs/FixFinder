import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { config as dotenvConfig } from "dotenv";

// Load the shared monorepo .env when running the admin app from apps/admin.
const sharedEnvPath = path.resolve(__dirname, "..", "..", ".env");
if (fs.existsSync(sharedEnvPath)) {
  dotenvConfig({ path: sharedEnvPath });
}

const nextConfig: NextConfig = {
  reactStrictMode: true
};

export default nextConfig;
