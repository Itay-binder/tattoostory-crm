import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/__/auth/:path*", destination: "https://tattoostory-crm.firebaseapp.com/__/auth/:path*" },
      { source: "/__/firebase/:path*", destination: "https://tattoostory-crm.firebaseapp.com/__/firebase/:path*" },
    ];
  },
};

export default nextConfig;
