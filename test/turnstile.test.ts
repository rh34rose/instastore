import { describe, expect, it, vi } from 'vitest';
import { checkTurnstileSecret, verifyTurnstile, type Fetcher } from '../src/turnstile';

/** A stand-in for siteverify that answers with `reply` and records what it was sent. */
function siteverify(reply: unknown) {
  return vi.fn<Fetcher>(async () => Response.json(reply));
}

function sent(fetcher: ReturnType<typeof siteverify>): URLSearchParams {
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  expect(init.method).toBe('POST');
  return new URLSearchParams(init.body as URLSearchParams);
}

describe('verifyTurnstile', () => {
  it("posts the secret, the token and the shopper's IP, and passes only on success", async () => {
    const fetcher = siteverify({ success: true, 'error-codes': [] });
    expect(await verifyTurnstile('s3cret', 'token-1', '203.0.113.7', fetcher)).toEqual({ ok: true });
    expect(Object.fromEntries(sent(fetcher))).toEqual({ secret: 's3cret', response: 'token-1', remoteip: '203.0.113.7' });
  });

  it('leaves the IP out when it is unknown', async () => {
    const fetcher = siteverify({ success: true });
    await verifyTurnstile('s3cret', 'token-1', null, fetcher);
    expect(sent(fetcher).has('remoteip')).toBe(false);
  });

  it('refuses a missing token without calling Cloudflare', async () => {
    const fetcher = siteverify({ success: true });
    expect(await verifyTurnstile('s3cret', '', null, fetcher)).toEqual({ ok: false, reason: 'missing', errorCodes: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('tells rejected tokens apart from checks that could not run', async () => {
    expect(await verifyTurnstile('s', 't', null, siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] }))).toEqual({
      ok: false,
      reason: 'rejected',
      errorCodes: ['timeout-or-duplicate'],
    });
    expect(await verifyTurnstile('s', 't', null, siteverify({ success: false, 'error-codes': ['invalid-input-secret'] }))).toMatchObject({ reason: 'unavailable' });
    expect(await verifyTurnstile('s', 't', null, vi.fn<Fetcher>(async () => new Response('<html>oops</html>', { status: 502 })))).toMatchObject({ reason: 'unavailable' });
    expect(await verifyTurnstile('s', 't', null, vi.fn<Fetcher>(async () => Promise.reject(new Error('network down'))))).toEqual({
      ok: false,
      reason: 'unavailable',
      errorCodes: ['network down'],
    });
  });

  it('never passes on anything but success === true', async () => {
    expect(await verifyTurnstile('s', 't', null, siteverify({ success: 'true' }))).toMatchObject({ ok: false, reason: 'rejected' });
    expect(await verifyTurnstile('s', 't', null, siteverify({}))).toMatchObject({ ok: false });
  });
});

describe('checkTurnstileSecret', () => {
  it('reads the verdict on a probe token', async () => {
    expect(await checkTurnstileSecret('real', siteverify({ success: false, 'error-codes': ['invalid-input-response'] }))).toBe('valid');
    expect(await checkTurnstileSecret('test-pass', siteverify({ success: true }))).toBe('valid');
    expect(await checkTurnstileSecret('typo', siteverify({ success: false, 'error-codes': ['invalid-input-secret'] }))).toBe('invalid');
    expect(await checkTurnstileSecret('real', vi.fn<Fetcher>(async () => Promise.reject(new Error('offline'))))).toBe('unknown');
  });

  it('sends the probe token, not a real one', async () => {
    const fetcher = siteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    await checkTurnstileSecret('real', fetcher);
    expect(sent(fetcher).get('response')).toBe('XXXX.DUMMY.TOKEN.XXXX');
  });
});
