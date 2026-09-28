import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { OTP_RESEND_INTERVAL_MS, OTP_TTL_MS, PENDING_CHECKOUT_TTL_MS } from '../src/otp';
import type { StoreDO } from '../src/store';

const store = () => env.STORE.getByName(`test-${crypto.randomUUID()}`);

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

describe('StoreDO settings', () => {
  it('returns defaults for a fresh store and persists updates', async () => {
    const s = store();
    const initial = await s.getSettings();
    expect(initial.storeName).toBe('My Store');
    expect(initial.storeOpen).toBe(true);

    const updated = await s.updateSettings({ storeName: 'Amma Pickles', currency: 'INR', deliveryFee: 4000 });
    expect(updated.storeName).toBe('Amma Pickles');
    expect((await s.getSettings()).deliveryFee).toBe(4000);
  });

  it('keeps the Turnstile secret out of the settings every page gets', async () => {
    const s = store();
    expect(await s.hasTurnstileSecret()).toBe(false);
    await s.setTurnstileSecret(' 0x4AAAAAAA-secret ');
    expect(await s.getTurnstileSecret()).toBe('0x4AAAAAAA-secret');
    expect(await s.hasTurnstileSecret()).toBe(true);
    expect(JSON.stringify(await s.getSettings())).not.toContain('0x4AAAAAAA-secret');
  });

});

describe('StoreDO catalog', () => {
  it('creates categories with unique slugs and sorts them', async () => {
    const s = store();
    const pickles = await s.createCategory({ name: 'Pickles', sortOrder: 2 });
    const pickles2 = await s.createCategory({ name: 'Pickles', sortOrder: 1 });
    expect(pickles.slug).toBe('pickles');
    expect(pickles2.slug).toBe('pickles-2');

    const list = await s.listCategories();
    expect(list.map((c) => c.id)).toEqual([pickles2.id, pickles.id]);
    expect(await s.getCategoryBySlug('pickles')).toMatchObject({ id: pickles.id });
  });

  it('updates and deletes categories, orphaning their products', async () => {
    const s = store();
    const cat = await s.createCategory({ name: 'Snacks' });
    const product = await s.createProduct({ name: 'Murukku', price: 12000, categoryId: cat.id });
    expect(product.categoryId).toBe(cat.id);

    const renamed = await s.updateCategory(cat.id, { name: 'Savouries', slug: '' });
    expect(renamed?.slug).toBe('savouries');
    expect(await s.updateCategory('missing', { name: 'x' })).toBeNull();

    await s.deleteCategory(cat.id);
    expect(await s.getCategory(cat.id)).toBeNull();
    expect((await s.getProduct(product.id))?.categoryId).toBeNull();
  });

  it('creates, filters and updates products', async () => {
    const s = store();
    const cat = await s.createCategory({ name: 'Sweets' });
    const a = await s.createProduct({ name: 'Mysore Pak', price: 25000, categoryId: cat.id, featured: true });
    const b = await s.createProduct({ name: 'Jalebi', price: 18000, categoryId: cat.id, active: false });
    const c = await s.createProduct({ name: 'Plain Dosa Mix', price: 9000 });

    expect((await s.listProducts()).map((p) => p.id)).toHaveLength(3);
    expect((await s.listProducts({ activeOnly: true })).map((p) => p.id)).toEqual(expect.arrayContaining([a.id, c.id]));
    expect((await s.listProducts({ categoryId: cat.id, activeOnly: true })).map((p) => p.id)).toEqual([a.id]);
    expect((await s.listProducts({ categoryId: null })).map((p) => p.id)).toEqual([c.id]);
    expect((await s.listProducts({ featuredOnly: true })).map((p) => p.id)).toEqual([a.id]);
    expect((await s.listProducts({ query: 'dosa' })).map((p) => p.id)).toEqual([c.id]);
    expect(await s.getProductBySlug('jalebi')).toMatchObject({ id: b.id, active: false });

    const updated = await s.updateProduct(a.id, { price: 26000, compareAtPrice: 30000, inStock: false });
    expect(updated).toMatchObject({ price: 26000, compareAtPrice: 30000, inStock: false, slug: 'mysore-pak' });

    expect(await s.updateProduct('nope', { name: 'x' })).toBeNull();
  });

  it('ignores a category id that does not exist', async () => {
    const s = store();
    const p = await s.createProduct({ name: 'Thing', price: 100, categoryId: 'ghost' });
    expect(p.categoryId).toBeNull();
  });

  it('stores and serves images, and drops them with the product', async () => {
    const s = store();
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]).buffer;
    const imageId = await s.putImage('image/png', bytes);
    const stored = await s.getImage(imageId);
    expect(stored?.contentType).toBe('image/png');
    expect(new Uint8Array(stored!.data)).toEqual(new Uint8Array(bytes));

    const product = await s.createProduct({ name: 'Pic', price: 100, imageIds: [imageId] });
    await s.deleteProduct(product.id);
    expect(await s.getImage(imageId)).toBeNull();
  });
});

describe('StoreDO orders', () => {
  const customer = { name: 'Asha', phone: '9999999999', email: null, address: '12 MG Road' };

  it('prices orders server-side, numbers them sequentially and applies delivery rules', async () => {
    const s = store();
    await s.updateSettings({ deliveryFee: 5000, freeDeliveryOver: 50000 });
    const a = await s.createProduct({ name: 'A', price: 10000 });
    const b = await s.createProduct({ name: 'B', price: 20000 });

    const first = await s.placeOrder({ customer, items: [{ productId: a.id, qty: 2 }, { productId: a.id, qty: 1 }] });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    expect(first.order.number).toBe(1001);
    expect(first.order.items).toEqual([expect.objectContaining({ productId: a.id, qty: 3, price: 10000 })]);
    expect(first.order).toMatchObject({ subtotal: 30000, deliveryFee: 5000, total: 35000, status: 'new', paymentMethod: 'cod' });

    const second = await s.placeOrder({ customer, items: [{ productId: a.id, qty: 1 }, { productId: b.id, qty: 2 }] });
    if (!second.ok) throw new Error('unreachable');
    expect(second.order.number).toBe(1002);
    expect(second.order).toMatchObject({ subtotal: 50000, deliveryFee: 0, total: 50000 });

    const listed = await s.listOrders();
    expect(listed.map((o) => o.number)).toEqual([1002, 1001]);
    expect((await s.listOrders({ status: 'confirmed' })).length).toBe(0);
  });

  it('refuses empty carts, unavailable items and closed stores', async () => {
    const s = store();
    const hidden = await s.createProduct({ name: 'Hidden', price: 100, active: false });
    const gone = await s.createProduct({ name: 'Sold out', price: 100, inStock: false });

    expect(await s.placeOrder({ customer, items: [] })).toMatchObject({ ok: false, code: 'empty' });
    expect(await s.placeOrder({ customer, items: [{ productId: 'missing', qty: 1 }] })).toMatchObject({ ok: false, code: 'unavailable' });
    expect(await s.placeOrder({ customer, items: [{ productId: hidden.id, qty: 1 }] })).toMatchObject({ ok: false, code: 'unavailable' });
    expect(await s.placeOrder({ customer, items: [{ productId: gone.id, qty: 1 }] })).toMatchObject({ ok: false, code: 'unavailable' });

    await s.updateSettings({ storeOpen: false });
    const ok = await s.createProduct({ name: 'Ok', price: 100 });
    expect(await s.placeOrder({ customer, items: [{ productId: ok.id, qty: 1 }] })).toMatchObject({ ok: false, code: 'closed' });
  });

  it('tracks status and notification outcome', async () => {
    const s = store();
    const p = await s.createProduct({ name: 'P', price: 100 });
    const placed = await s.placeOrder({ customer, items: [{ productId: p.id, qty: 99 }] });
    if (!placed.ok) throw new Error('unreachable');
    expect(placed.order.items[0]?.qty).toBe(99);

    const confirmed = await s.updateOrderStatus(placed.order.id, 'confirmed');
    expect(confirmed?.status).toBe('confirmed');
    await s.setOrderNotification(placed.order.id, 'sent');
    expect((await s.getOrder(placed.order.id))?.notification).toBe('sent');

    expect(await s.updateOrderStatus('nope', 'shipped')).toBeNull();
    // @ts-expect-error – an unknown status must be rejected at runtime too
    expect(await s.updateOrderStatus(placed.order.id, 'bogus')).toBeNull();

    const stats = await s.getStats();
    expect(stats).toMatchObject({ products: 1, activeProducts: 1, categories: 0 });
    expect(stats.orders.confirmed).toBe(1);
  });
});

describe('StoreDO checkout verification', () => {
  const customer = { name: 'Asha', phone: '9999999999', email: 'Asha@Example.com', address: '12 MG Road' };

  /** Codes, cooldowns and pending checkouts run on stored timestamps; pushing one back stands in for waiting. */
  async function rewind(s: DurableObjectStub<StoreDO>, table: 'pending_checkouts' | 'codes_sent', column: string, ms: number) {
    await runInDurableObject(s, (_instance, state) => {
      state.storage.sql.exec(`UPDATE ${table} SET ${column} = ${column} - ?`, ms);
    });
  }

  async function withProduct() {
    const s = store();
    const product = await s.createProduct({ name: 'Mango pickle', price: 100 });
    return { s, product, items: [{ productId: product.id, qty: 2 }] };
  }

  it('places the order only with the emailed code, and only once', async () => {
    const { s, items } = await withProduct();
    const { pending, otp } = ok(await s.startCheckout({ customer, notes: ' Ring twice ' }));
    expect(otp).toMatch(/^[0-9]{6}$/);
    expect(pending).toMatchObject({ customer, notes: 'Ring twice', attemptsLeft: 5 });
    expect(JSON.stringify(pending)).not.toContain(otp);
    expect(await s.getPendingCheckout(pending.id)).toEqual(pending);
    expect(await s.listOrders()).toHaveLength(0);

    const { order } = ok(await s.confirmCheckout(pending.id, otp, items));
    expect(order).toMatchObject({ customer, notes: 'Ring twice', total: 200 });
    // The code is spent with the order: replaying it cannot place a second one.
    expect(await s.confirmCheckout(pending.id, otp, items)).toMatchObject({ ok: false, code: 'missing' });
    expect(await s.getPendingCheckout(pending.id)).toBeNull();
    expect(await s.listOrders()).toHaveLength(1);
  });

  it('counts wrong codes down, then locks the code until a new one is sent', async () => {
    const { s, items } = await withProduct();
    const { pending, otp } = ok(await s.startCheckout({ customer }));
    const wrong = otp === '000000' ? '111111' : '000000';

    expect(await s.confirmCheckout(pending.id, wrong, items)).toMatchObject({ ok: false, code: 'wrong_code', message: expect.stringContaining('4 tries left') });
    for (let i = 0; i < 3; i++) await s.confirmCheckout(pending.id, wrong, items);
    expect(await s.confirmCheckout(pending.id, wrong, items)).toMatchObject({ ok: false, code: 'locked' });
    // Even the right code is refused now, so guessing cannot go on.
    expect(await s.confirmCheckout(pending.id, otp, items)).toMatchObject({ ok: false, code: 'locked' });
    expect((await s.getPendingCheckout(pending.id))?.attemptsLeft).toBe(0);
    expect(await s.listOrders()).toHaveLength(0);

    await rewind(s, 'pending_checkouts', 'sent_at', OTP_RESEND_INTERVAL_MS);
    const resent = ok(await s.resendCheckoutCode(pending.id));
    expect(resent.pending.attemptsLeft).toBe(5);
    if (resent.otp !== otp) expect(await s.confirmCheckout(pending.id, otp, items)).toMatchObject({ code: 'wrong_code' });
    ok(await s.confirmCheckout(pending.id, resent.otp, items));
  });

  it('refuses an expired code without using up a try', async () => {
    const { s, items } = await withProduct();
    const { pending, otp } = ok(await s.startCheckout({ customer }));
    await rewind(s, 'pending_checkouts', 'code_expires_at', OTP_TTL_MS);
    expect(await s.confirmCheckout(pending.id, otp, items)).toMatchObject({ ok: false, code: 'expired' });
    expect((await s.getPendingCheckout(pending.id))?.attemptsLeft).toBe(5);
  });

  it('spaces out new codes and caps how many one address gets in an hour', async () => {
    const s = store();
    const { pending } = ok(await s.startCheckout({ customer }));
    expect(await s.resendCheckoutCode(pending.id)).toMatchObject({ ok: false, code: 'too_soon', message: expect.stringMatching(/wait \d+ seconds/) });

    // Four more checkouts to the same address, however it is capitalised, use up the hour's allowance…
    for (let i = 0; i < 4; i++) ok(await s.startCheckout({ customer: { ...customer, email: 'asha@example.COM' } }));
    expect(await s.startCheckout({ customer })).toMatchObject({ ok: false, code: 'rate_limited', message: expect.stringMatching(/try again in \d+ minutes/) });
    await rewind(s, 'pending_checkouts', 'sent_at', OTP_RESEND_INTERVAL_MS);
    expect(await s.resendCheckoutCode(pending.id)).toMatchObject({ ok: false, code: 'rate_limited' });
    // …without affecting anyone else, and only for an hour.
    ok(await s.startCheckout({ customer: { ...customer, email: 'ravi@example.com' } }));
    await rewind(s, 'codes_sent', 'sent_at', 60 * 60 * 1000);
    ok(await s.startCheckout({ customer }));
  });

  it('keeps a right code usable when the order itself cannot be placed', async () => {
    const { s, product, items } = await withProduct();
    const { pending, otp } = ok(await s.startCheckout({ customer }));
    await s.updateProduct(product.id, { inStock: false });
    expect(await s.confirmCheckout(pending.id, otp, items)).toMatchObject({ ok: false, code: 'unavailable' });
    await s.updateProduct(product.id, { inStock: true });
    ok(await s.confirmCheckout(pending.id, otp, items));
  });

  it('replaces the previous pending checkout and forgets stale ones', async () => {
    const s = store();
    const first = ok(await s.startCheckout({ customer }));
    const second = ok(await s.startCheckout({ customer: { ...customer, address: '14 MG Road' } }, first.pending.id));
    expect(await s.getPendingCheckout(first.pending.id)).toBeNull();
    expect((await s.getPendingCheckout(second.pending.id))?.customer.address).toBe('14 MG Road');

    // A pending checkout lasts an hour from its latest code, however long ago it was started…
    await rewind(s, 'pending_checkouts', 'created_at', PENDING_CHECKOUT_TTL_MS);
    expect(await s.getPendingCheckout(second.pending.id)).not.toBeNull();
    // …and is forgotten once that hour has passed.
    await rewind(s, 'pending_checkouts', 'sent_at', PENDING_CHECKOUT_TTL_MS);
    expect(await s.getPendingCheckout(second.pending.id)).toBeNull();
    expect(await s.resendCheckoutCode(second.pending.id)).toMatchObject({ ok: false, code: 'missing' });
  });

  it('insists on an email address', async () => {
    // Called on the instance: a throw over RPC surfaces as an unhandled rejection in the test pool.
    await runInDurableObject(store(), (instance) => {
      expect(() => instance.startCheckout({ customer: { ...customer, email: null } })).toThrow('email address is required');
    });
  });
});
