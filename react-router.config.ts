import type { Config } from "@react-router/dev/config";

export default {
  // 开启服务端渲染（SSR），跑在 Cloudflare Workers 上
  ssr: true,
} satisfies Config;
