import type { FC } from 'hono/jsx';
import { formatMoney } from '../../money';
import type { Order } from '../../types';
import { ORDER_STATUS_LABELS } from '../../types';
import { formatDate } from '../text';
import { AdminPage, type AdminShell } from './layout';

const Step: FC<{ done: boolean; children?: unknown }> = ({ done, children }) => (
  <li class={done ? 'done' : 'todo'}>
    <span class="step-mark" aria-hidden="true">
      {done ? '✓' : '○'}
    </span>
    <span>{children}</span>
  </li>
);

/** `canTakeOrders` is false while email confirmation is on but the store cannot send the codes. */
export const DashboardPage: FC<{ shell: AdminShell; recentOrders: Order[]; host: string; canTakeOrders: boolean }> = ({
  shell,
  recentOrders,
  host,
  canTakeOrders,
}) => {
  const { settings, stats } = shell;
  const totalOrders = Object.values(stats.orders).reduce((a, b) => a + b, 0);
  const onWorkersDev = host.endsWith('.workers.dev') || host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const emailReady = settings.notifyEmail !== '' && settings.fromEmail !== '';
  return (
    <AdminPage shell={shell} title="Dashboard">
      {!canTakeOrders ? (
        <div class="notice notice-error" role="alert">
          <strong>Shoppers cannot place orders.</strong> Email confirmation is on, so every order needs a code emailed to the
          shopper, and this store cannot send email. <a href="/admin/settings#email">Set up order emails</a>, or turn off{' '}
          <a href="/admin/settings#protection">email confirmation</a>.
        </div>
      ) : null}
      {settings.confirmEmail ? (
        <div class="notice notice-warn">
          <strong>Email confirmation works only on the Cloudflare Workers Paid plan.</strong> On the free plan Cloudflare emails
          only your own verified addresses, so shoppers never receive their codes and cannot place orders. If your account is on
          the free plan, <a href="/admin/settings#protection">turn email confirmation off</a>.
        </div>
      ) : null}
      <div class="stat-row">
        <a href="/admin/orders?status=new" class="stat">
          <strong>{stats.orders.new}</strong>
          <span>New orders</span>
        </a>
        <a href="/admin/orders" class="stat">
          <strong>{totalOrders}</strong>
          <span>Total orders</span>
        </a>
        <a href="/admin/products" class="stat">
          <strong>{stats.activeProducts}</strong>
          <span>Active products</span>
        </a>
        <a href="/admin/categories" class="stat">
          <strong>{stats.categories}</strong>
          <span>Categories</span>
        </a>
      </div>

      <section class="panel">
        <h2>Setup checklist</h2>
        <ul class="steps">
          <Step done={!shell.devBypass}>
            Admin protected by Cloudflare Access{shell.devBypass ? ' — running in dev mode without Access' : ''}
          </Step>
          <Step done={settings.storeName !== 'My Store'}>
            <a href="/admin/settings">Name your store</a> and pick a currency
          </Step>
          <Step done={stats.categories > 0}>
            <a href="/admin/categories">Add categories</a>
          </Step>
          <Step done={stats.products > 0}>
            <a href="/admin/products/new">Add your first product</a>
          </Step>
          <Step done={emailReady}>
            <a href="/admin/settings#email">Set up order emails</a> — notification address and a sender on your domain
          </Step>
          <Step done={!onWorkersDev}>
            {onWorkersDev ? 'Add a custom domain to the Worker in the Cloudflare dashboard' : `Store is live at ${host}`}
          </Step>
        </ul>
      </section>

      <section class="panel">
        <h2>Recent orders</h2>
        {recentOrders.length === 0 ? (
          <p class="muted">No orders yet. Share your store link to get started.</p>
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>When</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o) => (
                <tr>
                  <td>
                    <a href={`/admin/orders/${o.id}`}>#{o.number}</a>
                  </td>
                  <td>{formatDate(o.createdAt, settings.locale)}</td>
                  <td>{o.customer.name}</td>
                  <td>{formatMoney(o.total, o.currency, settings.locale)}</td>
                  <td>
                    <span class={`status status-${o.status}`}>{ORDER_STATUS_LABELS[o.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </AdminPage>
  );
};
