import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The messaging packages are vendored TypeScript source (see packages/),
  // built by Next itself rather than a separate step.
  transpilePackages: ["@worldstreet/messaging-sdk", "@worldstreet/messaging-contracts"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "api.dicebear.com",
      },
    ],
  },
};

export default nextConfig;
