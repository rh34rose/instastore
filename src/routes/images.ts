import { Hono } from 'hono';
import type { AppEnv } from '../app';

const images = new Hono<AppEnv>();

const ID_RE = /^[0-9a-f-]{36}$/;

/**
 * Serves an uploaded image. Ids are random and content never changes, so
 * responses are cached at the edge for a year; only the first request per
 * location reaches the Durable Object.
 */
images.get('/img/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_RE.test(id)) return c.notFound();

  const cache = caches.default;
  const cacheKey = new Request(new URL(c.req.url).toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const image = await c.get('store').getImage(id);
  if (!image) return c.notFound();

  const response = new Response(image.data, {
    headers: {
      'content-type': image.contentType,
      'content-length': String(image.data.byteLength),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

export default images;
