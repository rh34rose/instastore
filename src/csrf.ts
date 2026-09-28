/**
 * Cross-site request forgery guard for form posts.
 *
 * Every browser that could be tricked into posting cross-site sends
 * `Sec-Fetch-Site` and/or `Origin`, so refusing requests where those signal
 * another site is enough. Requests without either header (curl, tests) are
 * not browser-initiated and pass through.
 */
export function isCrossSiteRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site !== 'same-origin' && site !== 'none';

  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (origin === 'null') return true;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}
