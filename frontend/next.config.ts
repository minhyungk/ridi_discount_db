import type { NextConfig } from "next";

if (process.env.NODE_ENV === "development") {
  (async () => {
    const { setupDevPlatform } = await import("@cloudflare/next-on-pages/next-dev");
    await setupDevPlatform();
  })();
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.ridicdn.net" },
    ],
  },
};

export default nextConfig;
