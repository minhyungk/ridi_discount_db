import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.ridicdn.net" },
    ],
  },
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    // Cloudflare는 `import("./x.wasm?module")` 문법을 쓰지만 webpack은 query를 못 알아봄.
    // resourceQuery 무시하고 .wasm 파일이면 webassembly/async로 처리.
    config.module.rules.push({
      test: /\.wasm$/,
      type: "webassembly/async",
    });
    return config;
  },
};

export default nextConfig;
