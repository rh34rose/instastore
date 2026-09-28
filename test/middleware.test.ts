import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccessKeyCache } from '../src/access';
import app from '../src/index';
import { accessClaims, makeAccessSigner } from './helpers/access';

async function request(path: string, init: RequestInit = {}, vars: Partial<Env> = {}) {
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(path, init), { ...env, ...vars }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('admin gate', () => {
  beforeEach(() => clearAccessKeyCache());
  afterEach(() => vi.restoreAllMocks());

  it('is locked until Access is configured', async () => {
    const res = await request('https://shop.example.com/admin', {}, { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ACCESS_DEV_BYPASS: 'false' });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Admin panel is locked');
  });

  it('denies requests without an Access token', async () => {
    const res = await request('https://shop.example.com/admin/orders', {}, { ACCESS_TEAM_DOMAIN: 'team', ACCESS_AUD: 'aud-123' });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Sign in required');
  });

  it('denies a token for another application and explains why', async () => {
    const signer = await makeAccessSigner();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => signer.certs());
    const token = await signer.sign(accessClaims({ aud: ['other-app'] }));
    const res = await request(
      'https://shop.example.com/admin',
      { headers: { 'cf-access-jwt-assertion': token } },
      { ACCESS_TEAM_DOMAIN: 'team', ACCESS_AUD: 'aud-123' },
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('wrong_audience');
  });

  it('lets a valid Access token through, from header or cookie', async () => {
    const signer = await makeAccessSigner();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => signer.certs());
    const token = await signer.sign(accessClaims());
    const vars = { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud-123' };

    const viaHeader = await request('https://shop.example.com/admin', { headers: { 'cf-access-jwt-assertion': token } }, vars);
    expect(viaHeader.status).toBe(200);
    expect(await viaHeader.text()).toContain('owner@example.com');

    const viaCookie = await request('https://shop.example.com/admin', { headers: { cookie: `CF_Authorization=${token}` } }, vars);
    expect(viaCookie.status).toBe(200);
  });

  it('only honours the dev bypass on localhost', async () => {
    const vars = { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ACCESS_DEV_BYPASS: 'true' };
    expect((await request('http://localhost:8787/admin', {}, vars)).status).toBe(200);
    expect((await request('http://127.0.0.1:8787/admin', {}, vars)).status).toBe(200);
    expect((await request('https://shop.example.com/admin', {}, vars)).status).toBe(403);
  });
});

describe('csrf guard', () => {
  it('blocks cross-site posts before routing', async () => {
    const res = await request('https://shop.example.com/cart/add', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Cross-site');
  });

  it('does not touch reads', async () => {
    const res = await request('https://shop.example.com/', { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(res.status).toBe(200);
  });
});
