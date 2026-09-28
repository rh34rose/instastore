import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { AccessError, verifyAccessJwt } from './access';
import type { AppEnv } from './app';
import { STORE_INSTANCE_NAME } from './app';
import { isCrossSiteRequest } from './csrf';
import { AccessDenied, AccessNotConfigured } from './views/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Makes the store stub available as c.get('store'). */
export const withStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('store', c.env.STORE.getByName(STORE_INSTANCE_NAME));
  await next();
};

/** Refuses cross-site form posts. */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method) && isCrossSiteRequest(c.req.raw)) {
    return c.text('Cross-site request blocked', 403);
  }
  await next();
};

/**
 * Gates /admin behind Cloudflare Access. Fails closed: no config → locked,
 * no token → denied. The only exception is `npm run dev` on localhost.
 */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const hostname = new URL(c.req.url).hostname;
  c.set('adminDev', false);
  if (c.env.ACCESS_DEV_BYPASS === 'true' && LOCAL_HOSTS.has(hostname)) {
    c.set('adminEmail', 'dev@localhost');
    c.set('adminDev', true);
    await next();
    return;
  }

  const teamDomain = c.env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = c.env.ACCESS_AUD?.trim();
  if (!teamDomain || !aud) return c.html(<AccessNotConfigured />, 403);

  const token = c.req.header('cf-access-jwt-assertion') ?? getCookie(c, 'CF_Authorization');
  if (!token) return c.html(<AccessDenied />, 403);

  try {
    const claims = await verifyAccessJwt(token, { teamDomain, aud });
    c.set('adminEmail', claims.email ?? claims.sub);
  } catch (err) {
    const reason = err instanceof AccessError ? err.code : 'verification_failed';
    console.warn(JSON.stringify({ message: 'access token rejected', reason, error: err instanceof Error ? err.message : String(err) }));
    return c.html(<AccessDenied reason={reason} />, 403);
  }
  await next();
};
