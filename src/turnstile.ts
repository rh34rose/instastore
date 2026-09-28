/**
 * Cloudflare Turnstile, the bot check on the checkout form. The widget runs
 * in the shopper's browser and adds a one-time token to the form; the
 * Worker confirms the token with Cloudflare's siteverify API before it does
 * anything with the order. The browser never talks to siteverify itself.
 */

export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
/** The form field the widget fills in with its token. */
export const TURNSTILE_FIELD = 'cf-turnstile-response';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** No widget ever issues this token, so siteverify answers it with "invalid-input-response" when the secret is real. */
const PROBE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
/** Error codes that mean the store's setup (or Cloudflare) is at fault rather than the shopper. */
const SETUP_ERRORS = new Set(['missing-input-secret', 'invalid-input-secret', 'internal-error']);

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/**
 * `missing`: the form carried no token. `rejected`: Cloudflare turned the
 * token down (expired, reused, failed). `unavailable`: the token could not
 * be checked at all.
 */
export type TurnstileResult = { ok: true } | { ok: false; reason: 'missing' | 'rejected' | 'unavailable'; errorCodes: string[] };

/** Canonical siteverify: POST the secret, the token and the shopper's IP, and trust nothing but `success === true`. */
export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<TurnstileResult> {
  if (!token) return { ok: false, reason: 'missing', errorCodes: [] };
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  let result: { success?: unknown; 'error-codes'?: unknown };
  try {
    const res = await fetcher(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    result = (await res.json()) as typeof result;
  } catch (err) {
    return { ok: false, reason: 'unavailable', errorCodes: [err instanceof Error ? err.message : String(err)] };
  }
  if (result.success === true) return { ok: true };
  const errorCodes = Array.isArray(result['error-codes']) ? result['error-codes'].map(String) : [];
  return { ok: false, reason: errorCodes.some((code) => SETUP_ERRORS.has(code)) ? 'unavailable' : 'rejected', errorCodes };
}

/**
 * Asks Cloudflare whether it knows a secret key, without needing a real
 * token: any verdict on the probe token means the key was accepted.
 */
export async function checkTurnstileSecret(secret: string, fetcher?: Fetcher): Promise<'valid' | 'invalid' | 'unknown'> {
  const result = await verifyTurnstile(secret, PROBE_TOKEN, null, fetcher);
  if (result.ok) return 'valid'; // Cloudflare's test keys that always pass
  if (result.errorCodes.includes('invalid-input-secret') || result.errorCodes.includes('missing-input-secret')) return 'invalid';
  if (result.reason === 'unavailable' || result.errorCodes.includes('bad-request')) return 'unknown';
  return 'valid';
}
