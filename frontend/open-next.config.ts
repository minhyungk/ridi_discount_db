import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  // Next.js 내부 FileSystemCache가 RSC prefetch(`?_rsc=...`)를 디스크에서 읽으려고
  // fs.readFile을 호출 → unenv에서 "not implemented" 에러. OpenNext가 캐시 lookup을
  // routing 단계에서 가로채 KV로 라우팅하면 fs.readFile 호출 자체가 발생 안 함.
  enableCacheInterception: true,
});
