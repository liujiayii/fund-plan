import { redirect } from 'react-router';
import type { Route } from './+types/logout';
import { getAppContext } from '~/services/context';
import { clearSessionCookie, destroySession, readTokenFromRequest } from '~/services/session';

/**
 * 登出。只接受 POST（GET 登出会被预取/爬虫误触发）。
 * 服务端销毁会话记录，同时让浏览器清掉 Cookie。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { db } = getAppContext(context);
  const token = readTokenFromRequest(request);
  await destroySession(db, token);
  return redirect('/', {
    headers: { 'Set-Cookie': clearSessionCookie() },
  });
}

/** 直接 GET 访问 /logout 就回首页，不做任何事 */
export async function loader() {
  return redirect('/');
}
