import { signAdminToken } from '../../server/middleware.js';

export function withPublicTestAuth(path: string, opts: RequestInit = {}): RequestInit {
  if (!path.startsWith('/api/public/')) return opts;
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string> | undefined) ?? {}),
  };
  const skipAutoPublicAuth = headers['x-no-auto-public-auth'] === 'true';
  delete headers['x-no-auto-public-auth'];
  if (skipAutoPublicAuth) return { ...opts, headers };
  if (
    !headers['x-auth-token']
    && !headers['X-Auth-Token']
    && !headers.Authorization
    && !headers.authorization
    && !headers.Cookie
  ) {
    headers['x-auth-token'] = signAdminToken();
  }
  return { ...opts, headers };
}
