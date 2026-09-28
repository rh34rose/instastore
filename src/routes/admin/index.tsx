import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { canTakeOrders } from '../../email';
import { DashboardPage } from '../../views/admin/dashboard';
import catalog from './catalog';
import orders from './orders';
import settings from './settings';
import { loadAdminShell } from './shared';

/** All /admin routes. Access enforcement happens in the app-level middleware. */
const admin = new Hono<AppEnv>();

admin.get('/admin', async (c) => {
  const [shell, recentOrders] = await Promise.all([loadAdminShell(c), c.get('store').listOrders({ limit: 5 })]);
  return c.html(
    <DashboardPage shell={shell} recentOrders={recentOrders} host={new URL(c.req.url).host} canTakeOrders={canTakeOrders(c.env.EMAIL, shell.settings)} />,
  );
});

admin.route('/', settings);
admin.route('/', catalog);
admin.route('/', orders);

export default admin;
