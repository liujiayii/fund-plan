/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * 测试环境类型补充。
 * cloudflare:test 的 env 类型是 Cloudflare.Env（见 cloudflare-test.d.ts），
 * 所以这里对该命名空间下的 Env 做接口声明合并，
 * 给它加上仅测试环境注入的迁移绑定。
 */
declare namespace Cloudflare {
  interface Env {
    /** setup-d1.ts 读取它来建表；仅测试环境注入 */
    TEST_MIGRATIONS: D1Migration[];
  }
}
