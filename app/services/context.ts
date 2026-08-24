import { cloudflareContext } from '../../workers/app';
import { getDb, type Db } from '~/db/client';

/**
 * loader / action 的公共入口：一把取出 db、env 与 ctx。
 *
 * 参数类型只要求「有 get 方法」，而不是具体的 RouterContextProvider——
 * React Router 传进 loader 的是 Readonly<RouterContextProvider>，
 * 带私有字段，无法直接赋给可变类型。这样写既类型安全又不用强转。
 *
 * 用法：
 *   export async function loader({ request, context }: Route.LoaderArgs) {
 *     const { db, env } = getAppContext(context)
 *     ...
 *   }
 */
interface ContextReader {
  get<T>(key: { defaultValue?: T }): T;
}

export function getAppContext(context: unknown): {
  db: Db;
  env: Env;
  ctx: ExecutionContext;
} {
  const cf = (context as ContextReader).get(cloudflareContext);
  return { db: getDb(cf.env.DB), env: cf.env, ctx: cf.ctx };
}
