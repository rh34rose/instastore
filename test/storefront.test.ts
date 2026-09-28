import { env } from 'cloudflare:workers';
import { reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORE_INSTANCE_NAME } from '../src/app';
import { OTP_RESEND_INTERVAL_MS, OTP_TTL_MS } from '../src/otp';
import { BASE, Session } from './helpers/session';
import { fakeSiteverify, siteverifyCalls } from './helpers/turnstile';

const store = () => env.STORE.getByName(STORE_INSTANCE_NAME);

// The pool shares storage across a file; start every test from an empty store.
beforeEach(() => reset());

async function seed() {
  const s = store();
  await s.updateSettings({
    storeName: 'Amma Pickles',
    tagline: 'Homemade, since 1984',
    deliveryFee: 5000,
    freeDeliveryOver: 100000,
    announcement: 'Free delivery over ₹1,000',
    fromEmail: 'orders@ammapickles.in',
  });
  const pickles = await s.createCategory({ name: 'Pickles' });
  const powders = await s.createCategory({ name: 'Spice powders' });
  const img = await s.putImage('image/png', new Uint8Array([1, 2, 3, 4]).buffer);
  const mango = await s.createProduct({ name: 'Mango pickle', price: 25000, compareAtPrice: 30000, categoryId: pickles.id, featured: true, imageIds: [img], description: 'Tangy.\n\nSpicy.' });
  const lime = await s.createProduct({ name: 'Lime pickle', price: 20000, categoryId: pickles.id });
  const sambar = await s.createProduct({ name: 'Sambar powder', price: 15000, categoryId: powders.id, inStock: false });
  const hidden = await s.createProduct({ name: 'Secret batch', price: 99900, active: false });
  return { s, pickles, powders, img, mango, lime, sambar, hidden };
}

describe('storefront pages', () => {
  it('renders the home page from settings and catalog', async () => {
    const { mango } = await seed();
    const res = await new Session().fetch('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Amma Pickles – Homemade, since 1984</title>');
    expect(html).toContain('Free delivery over ₹1,000');
    expect(html).toContain('href="/c/pickles"');
    expect(html).toContain('href="/c/spice-powders"');
    expect(html).toContain('Featured');
    expect(html).toContain(`/p/${mango.slug}`);
    expect(html).toContain('₹250.00');
    expect(html).toContain('₹300.00'); // compare-at price
    expect(html).not.toContain('Secret batch');
  });

  it('lists a category and searches all products', async () => {
    await seed();
    const category = await (await new Session().fetch('/c/pickles')).text();
    expect(category).toContain('Mango pickle');
    expect(category).toContain('Lime pickle');
    expect(category).not.toContain('Sambar powder');

    const search = await (await new Session().fetch('/products?q=SAMBAR')).text();
    expect(search).toContain('Results for “SAMBAR”');
    expect(search).toContain('Sambar powder');
    expect(search).toContain('Sold out');
    expect(search).not.toContain('Mango pickle');

    expect((await new Session().fetch('/c/nope')).status).toBe(404);
  });

  it('shows a product with its images, related items and open graph tags', async () => {
    const { mango, img } = await seed();
    const res = await new Session().fetch(`/p/${mango.slug}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>Mango pickle</h1>');
    expect(html).toContain(`src="/img/${img}"`);
    expect(html).toContain(`<meta property="og:image" content="${BASE}/img/${img}"`);
    expect(html).toContain('<p>Tangy.</p><p>Spicy.</p>');
    expect(html).toContain('You may also like');
    expect(html).toContain('Lime pickle');
    expect(html).toContain('name="productId"');
  });

  it('hides inactive products and disables ordering when out of stock', async () => {
    const { hidden, sambar } = await seed();
    expect((await new Session().fetch(`/p/${hidden.slug}`)).status).toBe(404);
    const html = await (await new Session().fetch(`/p/${sambar.slug}`)).text();
    expect(html).toContain('out of stock');
    expect(html).not.toContain('action="/cart/add"');
  });

  it('publishes a sitemap of public pages only', async () => {
    const { mango, hidden } = await seed();
    const res = await new Session().fetch('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toContain(`<loc>${BASE}/c/pickles</loc>`);
    expect(xml).toContain(`<loc>${BASE}/p/${mango.slug}</loc>`);
    expect(xml).not.toContain(hidden.slug);
  });

  it('serves images with long-lived cache headers', async () => {
    const { img } = await seed();
    const res = await new Session().fetch(`/img/${img}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect((await new Session().fetch(`/img/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await new Session().fetch('/img/../etc')).status).toBe(404);
  });
});

describe('cart and checkout', () => {
  let seeded: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => {
    seeded = await seed();
  });

  it('adds, updates and removes lines via cookie', async () => {
    const shopper = new Session();
    const add = await shopper.post('/cart/add', { productId: seeded.mango.id, qty: '2', return: `/p/${seeded.mango.slug}` });
    expect(add.status).toBe(302);
    expect(add.headers.get('location')).toBe(`/p/${seeded.mango.slug}?added=1`);
    expect(decodeURIComponent(shopper.cookies.get('cart')!)).toBe(`${seeded.mango.id}:2`);

    await shopper.post('/cart/add', { productId: seeded.lime.id, qty: '1' });
    let html = await (await shopper.fetch('/cart')).text();
    expect(html).toContain('Mango pickle');
    expect(html).toContain('Lime pickle');
    expect(html).toContain('₹700.00'); // subtotal 2×250 + 200
    expect(html).toContain('₹50.00'); // delivery fee below threshold
    expect(html).toContain('₹750.00');
    expect(html).toContain('<span class="badge">3</span>');

    await shopper.post('/cart/update', { productId: seeded.mango.id, qty: '4' });
    html = await (await shopper.fetch('/cart')).text();
    expect(html).toContain('₹1,200.00');
    expect(html).toContain('<dd>Free</dd>');

    await shopper.post('/cart/remove', { productId: seeded.mango.id });
    await shopper.post('/cart/update', { productId: seeded.lime.id, qty: '0' });
    expect(shopper.cookies.has('cart')).toBe(false);
    expect(await (await shopper.fetch('/cart')).text()).toContain('Your cart is empty');
  });

  it('refuses to add unavailable products and prunes them from the cart', async () => {
    const shopper = new Session();
    expect((await shopper.post('/cart/add', { productId: seeded.hidden.id, qty: '1' })).headers.get('location')).toBe('/cart');
    expect((await shopper.post('/cart/add', { productId: seeded.sambar.id, qty: '1' })).headers.get('location')).toBe('/cart');
    expect(shopper.cookies.has('cart')).toBe(false);

    await shopper.post('/cart/add', { productId: seeded.lime.id, qty: '1' });
    await seeded.s.updateProduct(seeded.lime.id, { inStock: false });
    const html = await (await shopper.fetch('/cart')).text();
    expect(html).toContain('out of stock and was removed');
    expect(shopper.cookies.has('cart')).toBe(false);
  });

  const details = { name: 'Asha Menon', phone: '+91 98765 43210', email: 'asha@example.com', address: '12, MG Road\nKochi 682001', notes: 'Ring the bell twice' };

  /** A shopper with mango pickle in their cart who has filled in the checkout form and been emailed a code. */
  async function atCodeStep() {
    const shopper = new Session();
    await shopper.post('/cart/add', { productId: seeded.mango.id, qty: '1' });
    expect((await shopper.post('/checkout', details)).headers.get('location')).toBe('/checkout/verify');
    return shopper;
  }

  /** Codes and cooldowns run on stored timestamps; pushing them back stands in for waiting. */
  async function rewindPendingCheckouts(column: 'sent_at' | 'code_expires_at', ms: number) {
    await runInDurableObject(store(), (_instance, state) => {
      state.storage.sql.exec(`UPDATE pending_checkouts SET ${column} = ${column} - ?`, ms);
    });
  }

  it('validates the checkout form and keeps what was typed', async () => {
    const shopper = new Session();
    await shopper.post('/cart/add', { productId: seeded.mango.id, qty: '1' });
    const res = await shopper.post('/checkout', { name: 'A', phone: 'abc', email: 'not-an-email', address: 'short', notes: '' });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Please enter your name.');
    expect(html).toContain('valid phone number');
    expect(html).toContain('does not look right');
    expect(html).toContain('full delivery address');
    expect(html).toContain('value="not-an-email"');
    expect(await seeded.s.listOrders()).toHaveLength(0);
  });

  it('places the order straight away while email confirmation is off', async () => {
    const shopper = new Session();
    await shopper.post('/cart/add', { productId: seeded.mango.id, qty: '2' });
    await shopper.post('/cart/add', { productId: seeded.lime.id, qty: '1' });
    const form = await (await shopper.fetch('/checkout')).text();
    expect(form).toContain('Email (optional)');
    expect(form).toContain('Place order');

    const res = await shopper.post('/checkout', { ...details, email: '' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toMatch(/^\/order\/[0-9a-f-]{36}\?placed=1$/);
    expect(shopper.cookies.has('cart')).toBe(false);
    expect(shopper.outbox.sent).toHaveLength(0); // no code, and no owner inbox set up for notifications

    const [order] = await seeded.s.listOrders();
    expect(order).toMatchObject({ number: 1001, status: 'new', total: 75000, deliveryFee: 5000, paymentMethod: 'cod' });
    expect(order?.customer).toEqual({ name: 'Asha Menon', phone: '+91 98765 43210', email: null, address: '12, MG Road\nKochi 682001' });
    expect(order?.items.map((i) => [i.name, i.qty])).toEqual([['Mango pickle', 2], ['Lime pickle', 1]]);

    const page = await (await shopper.fetch(location)).text();
    expect(page).toContain('Order placed!');
    expect(page).toContain('Ring the bell twice');
  });

  describe('with email confirmation on', () => {
    beforeEach(async () => {
      await seeded.s.updateSettings({ confirmEmail: true });
    });

    it('requires an email address', async () => {
      const shopper = new Session();
      await shopper.post('/cart/add', { productId: seeded.mango.id, qty: '1' });
      const form = await (await shopper.fetch('/checkout')).text();
      expect(form).not.toContain('Email (optional)');
      const res = await shopper.post('/checkout', { ...details, email: '' });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Please enter your email.');
      expect(shopper.outbox.sent).toHaveLength(0);
      expect(await seeded.s.listOrders()).toHaveLength(0);
    });

    it('places the order once the shopper enters the code emailed to them', async () => {
      const shopper = new Session();
      await shopper.post('/cart/add', { productId: seeded.mango.id, qty: '2' });
      await shopper.post('/cart/add', { productId: seeded.lime.id, qty: '1' });
      const cart = shopper.cookies.get('cart');
      const form = await (await shopper.fetch('/checkout')).text();
      expect(form).toContain('Continue');
      expect(form).not.toContain('Online ordering is unavailable');

      const res = await shopper.post('/checkout', details);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/checkout/verify');
      // Nothing is ordered yet: the details wait for the code, and the cart stays put.
      expect(await seeded.s.listOrders()).toHaveLength(0);
      expect(shopper.cookies.get('cart')).toBe(cart);
      expect(shopper.outbox.sent.map((m) => m.to)).toEqual(['asha@example.com']);

      const verify = await (await shopper.fetch('/checkout/verify')).text();
      expect(verify).toContain('We sent a 6-digit code to <strong>asha@example.com</strong>');
      expect(verify).toContain('Place order');
      expect(verify).toContain('₹750.00');
      expect(verify).toContain('Kochi 682001');

      const placed = await shopper.post('/checkout/verify', { code: shopper.outbox.codeFor('asha@example.com') });
      expect(placed.status).toBe(302);
      const location = placed.headers.get('location')!;
      expect(location).toMatch(/^\/order\/[0-9a-f-]{36}\?placed=1$/);
      expect(shopper.cookies.has('cart')).toBe(false);
      expect(shopper.cookies.has('checkout')).toBe(false);

      const [order] = await seeded.s.listOrders();
      expect(order).toMatchObject({ number: 1001, status: 'new', total: 75000, deliveryFee: 5000, paymentMethod: 'cod' });
      expect(order?.customer).toEqual({ name: 'Asha Menon', phone: '+91 98765 43210', email: 'asha@example.com', address: '12, MG Road\nKochi 682001' });
      expect(order?.items.map((i) => [i.name, i.qty])).toEqual([['Mango pickle', 2], ['Lime pickle', 1]]);

      const page = await (await shopper.fetch(location)).text();
      expect(page).toContain('Order placed!');
      expect(page).toContain('Order #1001');
      expect(page).toContain('Ring the bell twice');
      expect(page).toContain('₹750.00');
      expect(page).toContain('Kochi 682001');
    });

    it('places nothing and keeps the cart when the code is wrong', async () => {
      const shopper = await atCodeStep();
      const cart = shopper.cookies.get('cart');
      const code = shopper.outbox.codeFor('asha@example.com');
      const wrong = code === '000000' ? '111111' : '000000';

      const res = await shopper.post('/checkout/verify', { code: wrong });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('That code is not right. You have 4 tries left.');
      expect(await seeded.s.listOrders()).toHaveLength(0);
      expect(shopper.cookies.get('cart')).toBe(cart);
      expect(await (await shopper.fetch('/cart')).text()).toContain('Mango pickle');

      // Something that is not a code at all does not cost a try.
      const typo = await shopper.post('/checkout/verify', { code: '12345' });
      expect(typo.status).toBe(400);
      expect(await typo.text()).toContain('Please enter the 6-digit code');

      for (let i = 0; i < 4; i++) await shopper.post('/checkout/verify', { code: wrong });
      const locked = await shopper.post('/checkout/verify', { code });
      expect(locked.status).toBe(400);
      expect(await locked.text()).toContain('Too many wrong codes');
      expect(await seeded.s.listOrders()).toHaveLength(0);
      expect(shopper.cookies.get('cart')).toBe(cart);
    });

    it('refuses an expired code and keeps the cart', async () => {
      const shopper = await atCodeStep();
      await rewindPendingCheckouts('code_expires_at', OTP_TTL_MS);
      const res = await shopper.post('/checkout/verify', { code: shopper.outbox.codeFor('asha@example.com') });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('That code has expired');
      expect(await seeded.s.listOrders()).toHaveLength(0);
      expect(shopper.cookies.has('cart')).toBe(true);
    });

    it('sends a new code on request, at most every 30 seconds', async () => {
      const shopper = await atCodeStep();
      const first = shopper.outbox.codeFor('asha@example.com');

      const early = await shopper.post('/checkout/resend', {});
      expect(early.status).toBe(429);
      expect(await early.text()).toMatch(/Please wait \d+ seconds/);
      expect(shopper.outbox.sent).toHaveLength(1);

      await rewindPendingCheckouts('sent_at', OTP_RESEND_INTERVAL_MS);
      const resent = await shopper.post('/checkout/resend', {});
      expect(resent.headers.get('location')).toBe('/checkout/verify?resent=1');
      expect(resent.headers.getSetCookie().some((cookie) => cookie.startsWith('checkout='))).toBe(true);
      expect(await (await shopper.fetch('/checkout/verify?resent=1')).text()).toContain('We sent you a new code.');
      expect(shopper.outbox.sent).toHaveLength(2);
      const second = shopper.outbox.codeFor('asha@example.com');
      if (second !== first) expect((await shopper.post('/checkout/verify', { code: first })).status).toBe(400);
      expect((await shopper.post('/checkout/verify', { code: second })).headers.get('location')).toMatch(/^\/order\//);
    });

    it('lets the shopper go back and change their details, email included', async () => {
      const shopper = await atCodeStep();
      const form = await (await shopper.fetch('/checkout')).text();
      expect(form).toContain('value="asha@example.com"');
      expect(form).toContain('Ring the bell twice');

      const first = shopper.outbox.codeFor('asha@example.com');
      await shopper.post('/checkout', { ...details, email: 'asha.menon@example.com' });
      const second = shopper.outbox.codeFor('asha.menon@example.com');
      // The new details replaced the old ones, and the old code went with them.
      if (second !== first) expect((await shopper.post('/checkout/verify', { code: first })).status).toBe(400);
      await shopper.post('/checkout/verify', { code: second });
      const orders = await seeded.s.listOrders();
      expect(orders.map((o) => o.customer.email)).toEqual(['asha.menon@example.com']);
    });

    it('explains when the code cannot be emailed, and keeps the cart', async () => {
      const shopper = new Session();
      await shopper.post('/cart/add', { productId: seeded.mango.id, qty: '1' });

      shopper.outbox.failWith['asha@example.com'] = 'E_RECIPIENT_SUPPRESSED';
      const bounced = await shopper.post('/checkout', details);
      expect(bounced.status).toBe(502);
      expect(await bounced.text()).toContain('We could not deliver a code to asha@example.com');

      shopper.outbox.failWith['asha@example.com'] = 'E_SENDER_NOT_VERIFIED';
      const broken = await shopper.post('/checkout', details);
      expect(broken.status).toBe(502);
      expect(await broken.text()).toContain('We could not send your confirmation code just now');

      expect(shopper.cookies.has('checkout')).toBe(false);
      expect(shopper.cookies.has('cart')).toBe(true);
      expect(await seeded.s.listOrders()).toHaveLength(0);
    });

    it('does not take orders while the store cannot email codes', async () => {
      await seeded.s.updateSettings({ fromEmail: '', contactPhone: '98470 12345' });
      const shopper = new Session();
      await shopper.post('/cart/add', { productId: seeded.mango.id, qty: '1' });

      const page = await (await shopper.fetch('/checkout')).text();
      expect(page).toContain('Online ordering is unavailable');
      expect(page).toContain('Please contact us to order: 98470 12345.');
      expect(page).toMatch(/<button type="submit" class="btn btn-primary btn-block" disabled/);

      const res = await shopper.post('/checkout', details);
      expect(res.status).toBe(503);
      expect(shopper.outbox.sent).toHaveLength(0);
      expect(shopper.cookies.has('cart')).toBe(true);
      expect(await seeded.s.listOrders()).toHaveLength(0);
    });

    it('sends shoppers back to the cart when it is empty or the store is closed', async () => {
      const shopper = new Session();
      expect((await shopper.fetch('/checkout')).headers.get('location')).toBe('/cart');
      expect((await shopper.fetch('/checkout/verify')).headers.get('location')).toBe('/cart');

      await shopper.post('/cart/add', { productId: seeded.mango.id, qty: '1' });
      expect((await shopper.fetch('/checkout/verify')).headers.get('location')).toBe('/checkout');
      await shopper.post('/checkout', details);
      await seeded.s.updateSettings({ storeOpen: false, closedMessage: 'Back after Onam!' });
      const cart = await (await shopper.fetch('/cart')).text();
      expect(cart).toContain('Back after Onam!');
      expect(cart).not.toContain('href="/checkout"');
      expect((await shopper.fetch('/checkout')).headers.get('location')).toBe('/cart');
      const attempt = await shopper.post('/checkout', details);
      expect(attempt.headers.get('location')).toBe('/cart');
      const confirm = await shopper.post('/checkout/verify', { code: shopper.outbox.codeFor('asha@example.com') });
      expect(confirm.headers.get('location')).toBe('/cart');
      await rewindPendingCheckouts('sent_at', OTP_RESEND_INTERVAL_MS);
      expect((await shopper.post('/checkout/resend', {})).headers.get('location')).toBe('/cart');
      expect(shopper.outbox.sent).toHaveLength(1);
      expect(await seeded.s.listOrders()).toHaveLength(0);
      expect(shopper.cookies.has('cart')).toBe(true);
    });
  });

  describe('with Turnstile on', () => {
    let siteverify: ReturnType<typeof fakeSiteverify>;
    beforeEach(async () => {
      await seeded.s.setTurnstileSecret('0x4AAAAAAA-secret');
      await seeded.s.updateSettings({ turnstileEnabled: true, turnstileSiteKey: '0x4AAAAAAA-site' });
      siteverify = fakeSiteverify();
    });
    afterEach(() => vi.restoreAllMocks());

    async function withMango() {
      const shopper = new Session();
      await shopper.post('/cart/add', { productId: seeded.mango.id, qty: '1' });
      return shopper;
    }

    it('shows the check on the checkout form, and only the site key', async () => {
      const html = await (await (await withMango()).fetch('/checkout')).text();
      expect(html).toContain('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async="" defer=""></script>');
      expect(html).toContain('class="cf-turnstile" data-sitekey="0x4AAAAAAA-site"');
      expect(html).not.toContain('0x4AAAAAAA-secret');
    });

    it('places nothing without a passing check, and keeps the cart', async () => {
      const shopper = await withMango();
      const cart = shopper.cookies.get('cart');

      const missing = await shopper.post('/checkout', details);
      expect(missing.status).toBe(403);
      expect(await missing.text()).toContain('Please complete the security check');
      expect(siteverify).not.toHaveBeenCalled();

      const rejected = await shopper.post('/checkout', { ...details, 'cf-turnstile-response': 'bot-token' });
      expect(rejected.status).toBe(403);
      expect(await rejected.text()).toContain('The security check did not go through.');

      expect(await seeded.s.listOrders()).toHaveLength(0);
      expect(shopper.cookies.get('cart')).toBe(cart);
    });

    it("places the order once Cloudflare confirms the token, sending it the shopper's IP", async () => {
      const shopper = await withMango();
      const res = await shopper.fetch('/checkout', {
        method: 'POST',
        form: { ...details, 'cf-turnstile-response': 'good-token' },
        headers: { 'cf-connecting-ip': '203.0.113.7' },
      });
      expect(res.headers.get('location')).toMatch(/^\/order\//);
      expect(siteverifyCalls(siteverify)).toEqual([{ secret: '0x4AAAAAAA-secret', response: 'good-token', remoteip: '203.0.113.7' }]);
      expect(await seeded.s.listOrders()).toHaveLength(1);
    });

    it('turns shoppers away politely when the check cannot run', async () => {
      siteverify.mockRejectedValue(new Error('network down'));
      const res = await (await withMango()).post('/checkout', { ...details, 'cf-turnstile-response': 'good-token' });
      expect(res.status).toBe(503);
      expect(await res.text()).toContain('We could not run the security check just now.');
      expect(await seeded.s.listOrders()).toHaveLength(0);
    });

    it('checks before emailing a code when email confirmation is on too', async () => {
      await seeded.s.updateSettings({ confirmEmail: true });
      const shopper = await withMango();
      expect((await shopper.post('/checkout', { ...details, 'cf-turnstile-response': 'bot-token' })).status).toBe(403);
      expect(shopper.outbox.sent).toHaveLength(0);
      const res = await shopper.post('/checkout', { ...details, 'cf-turnstile-response': 'good-token' });
      expect(res.headers.get('location')).toBe('/checkout/verify');
      expect(shopper.outbox.sent).toHaveLength(1);
    });

    it('drops the check when it is switched off', async () => {
      await seeded.s.updateSettings({ turnstileEnabled: false });
      const shopper = await withMango();
      expect(await (await shopper.fetch('/checkout')).text()).not.toContain('cf-turnstile');
      expect((await shopper.post('/checkout', details)).headers.get('location')).toMatch(/^\/order\//);
      expect(siteverify).not.toHaveBeenCalled();
    });
  });
});
