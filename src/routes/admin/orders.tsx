import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { text } from '../../forms';
import { isOrderStatus } from '../../types';
import { OrderDetailPage, OrdersPage } from '../../views/admin/orders';
import { NotFoundPage } from '../../views/errors';
import { loadAdminShell, redirectWithFlash } from './shared';

const orders = new Hono<AppEnv>();

orders.get('/admin/orders', async (c) => {
  const statusParam = c.req.query('status') ?? '';
  const status = isOrderStatus(statusParam) ? statusParam : '';
  const [shell, list] = await Promise.all([loadAdminShell(c), c.get('store').listOrders({ status: status || undefined, limit: 200 })]);
  return c.html(<OrdersPage shell={shell} orders={list} status={status} stats={shell.stats} />);
});

orders.get('/admin/orders/:id', async (c) => {
  const [shell, order] = await Promise.all([loadAdminShell(c), c.get('store').getOrder(c.req.param('id'))]);
  if (!order) return c.html(<NotFoundPage home="/admin/orders" />, 404);
  return c.html(<OrderDetailPage shell={shell} order={order} />);
});

orders.post('/admin/orders/:id/status', async (c) => {
  const form = await c.req.formData();
  const status = text(form, 'status', 20);
  const id = c.req.param('id');
  if (!isOrderStatus(status)) return redirectWithFlash(c, `/admin/orders/${id}`, 'not-found');
  const updated = await c.get('store').updateOrderStatus(id, status);
  return redirectWithFlash(c, updated ? `/admin/orders/${id}` : '/admin/orders', updated ? 'status' : 'not-found');
});

export default orders;
