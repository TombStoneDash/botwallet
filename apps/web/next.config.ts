import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@botwallet/db", "@botwallet/ledger", "@botwallet/policy"],
};

export default nextConfig;
