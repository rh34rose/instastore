/** Test helper: stands in for Cloudflare's siteverify endpoint. */
import { vi } from 'vitest';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Replaces siteverify until `vi.restoreAllMocks()`: the token "good-token"
 * passes, any other is rejected, and the secret "wrong-secret" is unknown
 * to Cloudflare. Returns the spy on `fetch`.
 */
export function fakeSiteverify() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== SITEVERIFY_URL) throw new Error(`unexpected fetch to ${url}`);
    const form = new URLSearchParams(init?.body as URLSearchParams);
    if (form.get('secret') === 'wrong-secret') return Response.json({ success: false, 'error-codes': ['invalid-input-secret'] });
    if (form.get('response') === 'good-token') return Response.json({ success: true, 'error-codes': [] });
    return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
  });
}

/** The forms the spy posted to siteverify, in order. */
export function siteverifyCalls(spy: ReturnType<typeof fakeSiteverify>): Record<string, string>[] {
  return spy.mock.calls.map(([, init]) => Object.fromEntries(new URLSearchParams(init?.body as URLSearchParams)));
}
