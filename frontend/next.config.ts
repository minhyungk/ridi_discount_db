import type { NextConfig } from "next";

if (process.env.NODE_ENV === "development") {
  (async () => {
    const { initOpenNextCloudflareForDev } = await import("@opennextjs/cloudflare");
    initOpenNextCloudflareForDev();
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
