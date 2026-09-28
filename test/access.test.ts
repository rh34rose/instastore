import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessError, clearAccessKeyCache, normalizeTeamDomain, verifyAccessJwt } from '../src/access';
import { accessClaims, makeAccessSigner } from './helpers/access';

const config = { teamDomain: 'team.cloudflareaccess.com', aud: 'aud-123' };

async function expectCode(promise: Promise<unknown>, code: AccessError['code']) {
  await expect(promise).rejects.toMatchObject({ name: 'AccessError', code });
}

describe('normalizeTeamDomain', () => {
  it('accepts the team name, host or URL', () => {
    expect(normalizeTeamDomain('mystore')).toBe('mystore.cloudflareaccess.com');
    expect(normalizeTeamDomain(' MyStore.cloudflareaccess.com ')).toBe('mystore.cloudflareaccess.com');
    expect(normalizeTeamDomain('https://mystore.cloudflareaccess.com/')).toBe('mystore.cloudflareaccess.com');
    expect(normalizeTeamDomain('')).toBe('');
  });
});

describe('verifyAccessJwt', () => {
  beforeEach(() => clearAccessKeyCache());

  it('accepts a token signed by the team key for the right audience', async () => {
    const signer = await makeAccessSigner();
    const fetcher = vi.fn(async () => signer.certs());
    const token = await signer.sign(accessClaims());

    const claims = await verifyAccessJwt(token, config, fetcher);
    expect(claims.email).toBe('owner@example.com');
    expect(fetcher).toHaveBeenCalledWith('https://team.cloudflareaccess.com/cdn-cgi/access/certs');

    await verifyAccessJwt(token, { teamDomain: 'team', aud: 'aud-123' }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1); // keys are cached
  });

  it('accepts a string audience and refetches keys after a rotation', async () => {
    const old = await makeAccessSigner('old');
    const fresh = await makeAccessSigner('new');
    const responses = [old.certs(), fresh.certs()];
    const fetcher = vi.fn(async () => responses.shift() ?? fresh.certs());

    await verifyAccessJwt(await old.sign(accessClaims({ aud: 'aud-123' })), config, fetcher);
    // Cache is younger than the refresh floor, so an unknown kid is rejected without a refetch…
    await expectCode(verifyAccessJwt(await fresh.sign(accessClaims()), config, fetcher), 'unknown_key');
    expect(fetcher).toHaveBeenCalledTimes(1);
    // …but once the cache is old enough it refetches and accepts the rotated key.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 5 * 60 * 1000);
      await verifyAccessJwt(await fresh.sign(accessClaims()), config, fetcher, Date.now());
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects bad signatures, wrong audience, wrong issuer and expiry', async () => {
    const signer = await makeAccessSigner();
    const other = await makeAccessSigner(signer.kid);
    const fetcher = async () => signer.certs();

    await expectCode(verifyAccessJwt(await other.sign(accessClaims()), config, fetcher), 'bad_signature');

    const [h, , s] = (await signer.sign(accessClaims())).split('.');
    const tamperedPayload = btoa(JSON.stringify(accessClaims({ email: 'evil@example.com' }))).replace(/=+$/, '');
    await expectCode(verifyAccessJwt(`${h}.${tamperedPayload}.${s}`, config, fetcher), 'bad_signature');

    await expectCode(verifyAccessJwt(await signer.sign(accessClaims({ aud: ['someone-else'] })), config, fetcher), 'wrong_audience');
    await expectCode(verifyAccessJwt(await signer.sign(accessClaims({ iss: 'https://other.cloudflareaccess.com' })), config, fetcher), 'wrong_issuer');
    const past = Math.floor(Date.now() / 1000) - 5;
    await expectCode(verifyAccessJwt(await signer.sign(accessClaims({ exp: past })), config, fetcher), 'expired');
    await expectCode(verifyAccessJwt(await signer.sign(accessClaims({ nbf: past + 7200 })), config, fetcher), 'not_yet_valid');
  });

  it('rejects malformed tokens and unsupported algorithms', async () => {
    const signer = await makeAccessSigner();
    const fetcher = async () => signer.certs();

    await expectCode(verifyAccessJwt('nope', config, fetcher), 'malformed');
    await expectCode(verifyAccessJwt('a.b.c', config, fetcher), 'malformed');
    await expectCode(verifyAccessJwt(await signer.sign(accessClaims(), { alg: 'none', kid: signer.kid }), config, fetcher), 'bad_algorithm');
    await expectCode(verifyAccessJwt(await signer.sign(accessClaims(), { alg: 'HS256', kid: signer.kid }), config, fetcher), 'bad_algorithm');
    await expectCode(verifyAccessJwt(await signer.sign(accessClaims(), { alg: 'RS256' }), config, fetcher), 'malformed');
  });

  it('reports when the certs endpoint is unavailable', async () => {
    const signer = await makeAccessSigner();
    const token = await signer.sign(accessClaims());
    await expectCode(verifyAccessJwt(token, config, async () => new Response('down', { status: 503 })), 'certs_unavailable');
    await expectCode(verifyAccessJwt(token, config, async () => { throw new Error('dns'); }), 'certs_unavailable');
    await expectCode(verifyAccessJwt(token, config, async () => Response.json({})), 'certs_unavailable');
  });
});
