/**
 * Cloudflare Access (Zero Trust) JWT verification.
 *
 * Access puts a signed JWT in the `Cf-Access-Jwt-Assertion` header (and the
 * `CF_Authorization` cookie) of every request that passed its login. We verify
 * it ourselves rather than trusting headers, so the admin panel stays closed
 * even if a request reaches the Worker some other way (e.g. the workers.dev
 * hostname, which Access cannot protect).
 *
 * Docs: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

export interface AccessConfig {
  /** Zero Trust team domain, e.g. "mystore.cloudflareaccess.com". */
  teamDomain: string;
  /** Application Audience (AUD) tag of the Access application. */
  aud: string;
}

export interface AccessClaims {
  sub: string;
  email?: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  iss: string;
  [claim: string]: unknown;
}

export type AccessErrorCode =
  | 'malformed'
  | 'bad_algorithm'
  | 'unknown_key'
  | 'bad_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'certs_unavailable';

export class AccessError extends Error {
  constructor(
    readonly code: AccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccessError';
  }
}

export type Fetcher = (url: string) => Promise<Response>;

/** JWK as served by Access: a standard key plus its `kid`. */
type AccessJwk = JsonWebKey & { kid?: string };

/** Accepts "team", "team.cloudflareaccess.com" or a full URL and returns the bare host. */
export function normalizeTeamDomain(input: string): string {
  let host = input.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (host && !host.includes('.')) host = `${host}.cloudflareaccess.com`;
  return host;
}

// Public keys are cached per team domain. This is shared, non-request state,
// so keeping it at module level is safe and saves a round-trip per request.
const KEY_TTL_MS = 60 * 60 * 1000;
const KEY_MIN_REFRESH_MS = 60 * 1000;
const keyCache = new Map<string, { keys: AccessJwk[]; fetchedAt: number }>();

/** Test hook: forget cached keys. */
export function clearAccessKeyCache(): void {
  keyCache.clear();
}

async function fetchKeys(teamDomain: string, fetcher: Fetcher): Promise<AccessJwk[]> {
  let res: Response;
  try {
    res = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`);
  } catch (err) {
    throw new AccessError('certs_unavailable', `Could not reach ${teamDomain}: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) throw new AccessError('certs_unavailable', `Fetching Access certs returned HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: AccessJwk[] };
  if (!Array.isArray(body.keys)) throw new AccessError('certs_unavailable', 'Access certs response has no keys');
  keyCache.set(teamDomain, { keys: body.keys, fetchedAt: Date.now() });
  return body.keys;
}

async function findKey(teamDomain: string, kid: string, fetcher: Fetcher): Promise<AccessJwk | undefined> {
  const cached = keyCache.get(teamDomain);
  const fresh = cached && Date.now() - cached.fetchedAt < KEY_TTL_MS;
  let keys = fresh ? cached.keys : await fetchKeys(teamDomain, fetcher);
  let key = keys.find((k) => k.kid === kid);
  // Unknown kid may mean Cloudflare rotated keys; refetch, but not in a tight loop.
  if (!key && fresh && Date.now() - cached.fetchedAt > KEY_MIN_REFRESH_MS) {
    keys = await fetchKeys(teamDomain, fetcher);
    key = keys.find((k) => k.kid === kid);
  }
  return key;
}

function base64UrlDecode(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(segment: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as T;
  } catch {
    throw new AccessError('malformed', 'Token segment is not valid base64url JSON');
  }
}

/**
 * Verifies signature, expiry, issuer and audience of an Access JWT.
 * Resolves to the claims; rejects with AccessError otherwise.
 */
export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  fetcher: Fetcher = (url) => fetch(url),
  now: number = Date.now(),
): Promise<AccessClaims> {
  const teamDomain = normalizeTeamDomain(config.teamDomain);
  const parts = token.split('.');
  if (parts.length !== 3) throw new AccessError('malformed', 'Token must have three segments');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const header = decodeJson<{ alg?: string; kid?: string }>(headerB64);
  if (header.alg !== 'RS256') throw new AccessError('bad_algorithm', `Unsupported algorithm ${header.alg}`);
  if (!header.kid) throw new AccessError('malformed', 'Token header has no kid');

  const jwk = await findKey(teamDomain, header.kid, fetcher);
  if (!jwk) throw new AccessError('unknown_key', `No Access signing key with kid ${header.kid}`);

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new AccessError('bad_signature', 'Token signature does not verify');

  const claims = decodeJson<AccessClaims>(payloadB64);
  const nowSeconds = Math.floor(now / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) throw new AccessError('expired', 'Token has expired');
  if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + 60) throw new AccessError('not_yet_valid', 'Token is not valid yet');
  if (claims.iss !== `https://${teamDomain}`) throw new AccessError('wrong_issuer', `Token was issued by ${claims.iss}`);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.aud)) throw new AccessError('wrong_audience', 'Token is for a different Access application');

  return claims;
}
