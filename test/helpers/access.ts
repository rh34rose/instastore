/** Test helper: mints Cloudflare-Access-style RS256 JWTs with a throwaway key. */

function base64Url(bytes: ArrayBuffer | Uint8Array | string): string {
  const raw =
    typeof bytes === 'string'
      ? bytes
      : String.fromCharCode(...new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer as ArrayBuffer));
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface AccessSigner {
  kid: string;
  jwk: JsonWebKey & { kid: string };
  certs: () => Response;
  sign: (claims: Record<string, unknown>, header?: Record<string, unknown>) => Promise<string>;
}

export async function makeAccessSigner(kid = 'test-key'): Promise<AccessSigner> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey), kid };
  return {
    kid,
    jwk,
    certs: () => Response.json({ keys: [jwk] }),
    async sign(claims, header = { alg: 'RS256', kid, typ: 'JWT' }) {
      const head = base64Url(new TextEncoder().encode(JSON.stringify(header)));
      const body = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
      return `${head}.${body}.${base64Url(signature)}`;
    },
  };
}

export function accessClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'user-1',
    email: 'owner@example.com',
    aud: ['aud-123'],
    iss: 'https://team.cloudflareaccess.com',
    iat: now - 10,
    exp: now + 3600,
    ...overrides,
  };
}
