import { Hono } from 'hono';
import type { AppEnv } from './app';
import { csrfGuard, requireAccess, withStore } from './middleware';
import admin from './routes/admin';
import images from './routes/images';
import storefront from './routes/storefront';
import { ErrorPage, NotFoundPage } from './views/errors';

export { StoreDO } from './store';

const app = new Hono<AppEnv>();

app.use('*', withStore);
app.use('*', csrfGuard);
app.use('/admin', requireAccess);
app.use('/admin/*', requireAccess);

app.route('/', images);
app.route('/', admin);
app.route('/', storefront);

app.notFound((c) => c.html(<NotFoundPage />, 404));
app.onError((err, c) => {
  console.error(JSON.stringify({ message: 'unhandled error', path: new URL(c.req.url).pathname, error: err.message, stack: err.stack }));
  return c.html(<ErrorPage />, 500);
});

export default app;
