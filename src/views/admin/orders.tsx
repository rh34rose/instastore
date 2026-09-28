import type { FC } from 'hono/jsx';
import { formatMoney } from '../../money';
import type { Order, OrderStatus, StoreStats } from '../../types';
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '../../types';
import { formatDate } from '../text';
import { AdminPage, EmptyState, type AdminShell } from './layout';

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = { new: 'confirmed', confirmed: 'shipped', shipped: 'delivered' };

function whatsappLink(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

const NotificationBadge: FC<{ value: string }> = ({ value }) => {
  const kind = value === 'sent' ? 'ok' : value.startsWith('failed') ? 'warn' : '';
  return (
    <span class={`pill${kind ? ` pill-${kind}` : ''}`} title={value}>
      {value === 'sent' ? 'Email sent' : value.startsWith('failed') ? 'Email failed' : value.startsWith('skipped') ? 'Email skipped' : 'Email pending'}
    </span>
  );
};

export const OrdersPage: FC<{ shell: AdminShell; orders: Order[]; status: OrderStatus | ''; stats: StoreStats }> = ({ shell, orders, status, stats }) => {
  const { settings } = shell;
  const total = Object.values(stats.orders).reduce((a, b) => a + b, 0);
  return (
    <AdminPage shell={shell} title="Orders" wide>
      <nav class="tabs" aria-label="Filter by status">
        <a href="/admin/orders" class={status === '' ? 'active' : ''}>
          All <span class="count">{total}</span>
        </a>
        {ORDER_STATUSES.map((s) => (
          <a href={`/admin/orders?status=${s}`} class={status === s ? 'active' : ''}>
            {ORDER_STATUS_LABELS[s]} <span class="count">{stats.orders[s]}</span>
          </a>
        ))}
      </nav>
      {orders.length === 0 ? (
        <EmptyState>{status ? `No ${ORDER_STATUS_LABELS[status].toLowerCase()} orders.` : 'No orders yet.'}</EmptyState>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>When</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Total</th>
              <th>Status</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr>
                <td>
                  <a href={`/admin/orders/${o.id}`}>
                    <strong>#{o.number}</strong>
                  </a>
                </td>
                <td>{formatDate(o.createdAt, settings.locale)}</td>
                <td>
                  {o.customer.name}
                  <div class="muted small">{o.customer.phone}</div>
                </td>
                <td>{o.items.reduce((n, i) => n + i.qty, 0)}</td>
                <td>{formatMoney(o.total, o.currency, settings.locale)}</td>
                <td>
                  <span class={`status status-${o.status}`}>{ORDER_STATUS_LABELS[o.status]}</span>
                </td>
                <td>
                  <NotificationBadge value={o.notification} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminPage>
  );
};

export const OrderDetailPage: FC<{ shell: AdminShell; order: Order }> = ({ shell, order }) => {
  const { settings } = shell;
  const money = (n: number) => formatMoney(n, order.currency, settings.locale);
  const wa = whatsappLink(order.customer.phone);
  const next = NEXT_STATUS[order.status];
  return (
    <AdminPage shell={shell} title={`Order #${order.number}`} wide>
      <p>
        <a href="/admin/orders">← All orders</a>
      </p>
      <div class="two-col">
        <div>
          <section class="panel">
            <h2>Items</h2>
            <table class="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Line total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr>
                    <td>
                      {item.name}
                      <div class="muted small">
                        <a href={`/admin/products/${item.productId}`}>edit product</a>
                      </div>
                    </td>
                    <td>{item.qty}</td>
                    <td>{money(item.price)}</td>
                    <td>{money(item.price * item.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl class="totals">
              <dt>Subtotal</dt>
              <dd>{money(order.subtotal)}</dd>
              <dt>Delivery</dt>
              <dd>{order.deliveryFee === 0 ? 'Free' : money(order.deliveryFee)}</dd>
              <dt class="grand">Total to collect</dt>
              <dd class="grand">{money(order.total)}</dd>
            </dl>
            <p class="muted small">Payment: cash on delivery.</p>
          </section>
          <section class="panel">
            <h2>Customer</h2>
            <p>
              <strong>{order.customer.name}</strong>
            </p>
            <p>
              <a href={`tel:${order.customer.phone.replace(/\s+/g, '')}`}>{order.customer.phone}</a>
              {wa ? (
                <>
                  {' '}
                  · <a href={wa} target="_blank" rel="noopener">WhatsApp ↗</a>
                </>
              ) : null}
            </p>
            {order.customer.email ? (
              <p>
                <a href={`mailto:${order.customer.email}`}>{order.customer.email}</a>
              </p>
            ) : null}
            <p class="pre-line">{order.customer.address}</p>
            {order.notes ? (
              <p>
                <em>Customer notes:</em> {order.notes}
              </p>
            ) : null}
          </section>
        </div>
        <div>
          <section class="panel">
            <h2>Status</h2>
            <p>
              <span class={`status status-${order.status}`}>{ORDER_STATUS_LABELS[order.status]}</span>
            </p>
            <form method="post" action={`/admin/orders/${order.id}/status`}>
              <div class="field">
                <label for="f-status">Change status</label>
                <select id="f-status" name="status">
                  {ORDER_STATUSES.map((s) => (
                    <option value={s} selected={s === (next ?? order.status)}>
                      {ORDER_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" class="btn btn-primary">
                Update status
              </button>
            </form>
          </section>
          <section class="panel">
            <h2>Details</h2>
            <dl class="meta">
              <dt>Placed</dt>
              <dd>{formatDate(order.createdAt, settings.locale)}</dd>
              <dt>Updated</dt>
              <dd>{formatDate(order.updatedAt, settings.locale)}</dd>
              <dt>Notification</dt>
              <dd>
                <NotificationBadge value={order.notification} />
                {order.notification.startsWith('failed') || order.notification.startsWith('skipped') ? (
                  <div class="muted small">{order.notification}</div>
                ) : null}
              </dd>
              <dt>Order id</dt>
              <dd>
                <code class="small">{order.id}</code>
              </dd>
            </dl>
            <p class="small">
              <a href={`/order/${order.id}`} target="_blank" rel="noopener">
                Customer's view ↗
              </a>
            </p>
          </section>
        </div>
      </div>
    </AdminPage>
  );
};
