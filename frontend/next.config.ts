import type { NextConfig } from "next";

// Cloudflare Pages / Next.js 로컬 개발 시 호환 레이어 초기화
// (async IIFE — top-level await는 Next config 트랜스파일러와 호환 안 됨)
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
