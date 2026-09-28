import { env } from 'cloudflare:workers';
import { createExecutionContext, reset, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORE_INSTANCE_NAME } from '../src/app';
import app from '../src/index';

const BASE = 'http://localhost:8787';
const vars = { ACCESS_DEV_BYPASS: 'true' };

async function get(path: string) {
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`${BASE}${path}`, { redirect: 'manual' }), { ...env, ...vars }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function post(path: string, fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`${BASE}${path}`, { method: 'POST', body, redirect: 'manual' }), { ...env, ...vars }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const store = () => env.STORE.getByName(STORE_INSTANCE_NAME);

beforeEach(() => reset());

describe('admin orders', () => {
  it('lists, filters, shows and updates orders', async () => {
    const p = await store().createProduct({ name: 'Thing', price: 1500 });
    const customer = { name: 'Ravi', phone: '+91 98765 43210', email: 'ravi@example.com', address: '5 Beach Rd\nChennai' };
    const placed = await store().placeOrder({ customer, items: [{ productId: p.id, qty: 2 }], notes: 'Call first' });
    if (!placed.ok) throw new Error('unreachable');

    let html = await (await get('/admin/orders')).text();
    expect(html).toContain('#1001');
    expect(html).toContain('Ravi');
    expect(html).toContain('₹30.00');
    expect(html).toContain('Email pending');
    expect(await (await get('/admin/orders?status=shipped')).text()).not.toContain('#1001');
    expect(await (await get('/admin/orders?status=new')).text()).toContain('#1001');

    html = await (await get(`/admin/orders/${placed.order.id}`)).text();
    expect(html).toContain('Order #1001');
    expect(html).toContain('https://wa.me/919876543210');
    expect(html).toContain('Call first');
    expect(html).toContain('Chennai');
    expect(html).toContain('value="confirmed" selected'); // suggested next step

    const res = await post(`/admin/orders/${placed.order.id}/status`, { status: 'shipped' });
    expect(res.headers.get('location')).toBe(`/admin/orders/${placed.order.id}?flash=status`);
    expect((await store().getOrder(placed.order.id))?.status).toBe('shipped');

    expect((await post(`/admin/orders/${placed.order.id}/status`, { status: 'teleported' })).headers.get('location')).toContain('flash=not-found');
    expect((await post(`/admin/orders/${crypto.randomUUID()}/status`, { status: 'shipped' })).headers.get('location')).toBe('/admin/orders?flash=not-found');
    expect((await get(`/admin/orders/${crypto.randomUUID()}`)).status).toBe(404);

    const dashboard = await (await get('/admin')).text();
    expect(dashboard).toContain('#1001');
  });
});
