import { env } from 'cloudflare:workers';
import { createExecutionContext, reset, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORE_INSTANCE_NAME } from '../src/app';
import app from '../src/index';
import { fakeSiteverify } from './helpers/turnstile';

// Admin tests run on localhost with the dev bypass, exactly like `npm run dev`.
const BASE = 'http://localhost:8787';
const vars = { ACCESS_DEV_BYPASS: 'true' };

async function get(path: string) {
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`${BASE}${path}`, { redirect: 'manual' }), { ...env, ...vars }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function post(path: string, fields: Record<string, string | File | (string | File)[]>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => body.append(key, v));
    else body.append(key, value);
  }
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`${BASE}${path}`, { method: 'POST', body, redirect: 'manual' }), { ...env, ...vars }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const png = (name: string, size = 16) => new File([new Uint8Array(size).fill(7)], name, { type: 'image/png' });
const store = () => env.STORE.getByName(STORE_INSTANCE_NAME);

beforeEach(() => reset());

describe('admin dashboard', () => {
  it('renders stats and the setup checklist', async () => {
    const res = await get('/admin');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Dashboard');
    expect(html).toContain('dev mode');
    expect(html).toContain('Add your first product');
    expect(html).toContain('Add a custom domain');
    expect(html).toContain('No orders yet');
  });

  it('warns when email confirmation is on but codes cannot be sent', async () => {
    expect(await (await get('/admin')).text()).not.toContain('Shoppers cannot place orders.');
    await store().updateSettings({ confirmEmail: true });
    expect(await (await get('/admin')).text()).toContain('Shoppers cannot place orders.');
    await store().updateSettings({ fromEmail: 'orders@example.com' });
    expect(await (await get('/admin')).text()).not.toContain('Shoppers cannot place orders.');
  });

  it('reminds the owner that email confirmation needs the Workers Paid plan while it is on', async () => {
    const warning = 'Email confirmation works only on the Cloudflare Workers Paid plan.';
    expect(await (await get('/admin')).text()).not.toContain(warning);
    await store().updateSettings({ fromEmail: 'orders@example.com', confirmEmail: true });
    expect(await (await get('/admin')).text()).toContain(warning);
  });
});

describe('admin settings', () => {
  const valid = {
    storeName: 'Amma Pickles',
    tagline: 'Since 1984',
    currency: 'inr',
    locale: 'en-IN',
    deliveryFee: '40',
    freeDeliveryOver: '999',
    storeOpen: 'on',
    accentColor: '#aa3366',
    notifyEmail: 'owner@example.com',
    fromEmail: 'orders@example.com',
    fromName: 'Amma Pickles',
  };

  it('saves settings, converting money to minor units', async () => {
    const res = await post('/admin/settings', valid);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/settings?flash=saved');
    const s = await store().getSettings();
    expect(s).toMatchObject({ storeName: 'Amma Pickles', currency: 'INR', deliveryFee: 4000, freeDeliveryOver: 99900, storeOpen: true, accentColor: '#aa3366' });

    const page = await (await get('/admin/settings?flash=saved')).text();
    expect(page).toContain('Saved.');
    expect(page).toContain('value="40.00"');
    expect(page).toContain('value="999.00"');
  });

  it('rejects bad input and keeps the typed values', async () => {
    const res = await post('/admin/settings', { ...valid, storeName: '', currency: 'rupees', locale: 'nope!', deliveryFee: 'free', notifyEmail: 'not-an-email' });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Store name is required.');
    expect(html).toContain('three-letter currency code');
    expect(html).toContain('Use a locale');
    expect(html).toContain('Enter an amount');
    expect(html).toContain('does not look right');
    expect(html).toContain('value="RUPEES"');
    expect((await store().getSettings()).storeName).toBe('My Store');
  });

  it('asks the owner to confirm the Workers Paid plan before email confirmation can be ticked', async () => {
    const html = await (await get('/admin/settings')).text();
    const box = html.match(/<input type="checkbox" name="confirmEmail"[^>]*>/)?.[0];
    expect(box).toContain('data-confirm="Email confirmation works only if your Cloudflare account is on the Workers Paid plan.');
    expect(box).toContain('Press OK only if your account is on the Workers Paid plan.');
    expect(html.match(/<input type="checkbox" name="storeOpen"[^>]*>/)?.[0]).not.toContain('data-confirm');
  });

  it('turns email confirmation on only with a sender to send the codes', async () => {
    const refused = await post('/admin/settings', { ...valid, fromEmail: '', confirmEmail: 'on' });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Codes are sent from the sender address.');
    expect((await store().getSettings()).confirmEmail).toBe(false);

    expect((await post('/admin/settings', { ...valid, confirmEmail: 'on' })).status).toBe(302);
    expect((await store().getSettings()).confirmEmail).toBe(true);
    expect(await (await get('/admin/settings')).text()).toMatch(/name="confirmEmail" checked/);

    expect((await post('/admin/settings', valid)).status).toBe(302);
    expect((await store().getSettings()).confirmEmail).toBe(false);
  });

  it('uploads and removes a logo', async () => {
    let res = await post('/admin/settings', { ...valid, logo: png('logo.png') });
    expect(res.status).toBe(302);
    const logoId = (await store().getSettings()).logoImageId;
    expect(logoId).toBeTruthy();
    expect((await get(`/img/${logoId}`)).status).toBe(200);
    expect(await (await get('/')).text()).toContain(`/img/${logoId}`);

    res = await post('/admin/settings', { ...valid, removeLogo: 'on' });
    expect(res.status).toBe(302);
    expect((await store().getSettings()).logoImageId).toBeNull();
    expect(await store().getImage(logoId!)).toBeNull();
  });

  describe('Turnstile keys', () => {
    afterEach(() => vi.restoreAllMocks());
    const keys = { turnstileSiteKey: '0x4AAAAAAA-site', turnstileSecretKey: '0x4AAAAAAA-secret' };

    it('are saved once Cloudflare recognises the secret, which is never shown again', async () => {
      const siteverify = fakeSiteverify();

      const incomplete = await post('/admin/settings', { ...valid, turnstileEnabled: 'on' });
      expect(incomplete.status).toBe(400);
      let html = await incomplete.text();
      expect(html).toContain('Enter the site key of your Turnstile widget.');
      expect(html).toContain('Enter the secret key of your Turnstile widget.');

      const wrong = await post('/admin/settings', { ...valid, ...keys, turnstileEnabled: 'on', turnstileSecretKey: 'wrong-secret' });
      expect(wrong.status).toBe(400);
      html = await wrong.text();
      expect(html).toContain('Cloudflare does not recognise this secret key.');
      expect(html).not.toContain('wrong-secret');
      expect(await store().hasTurnstileSecret()).toBe(false);
      expect((await store().getSettings()).turnstileEnabled).toBe(false);

      expect((await post('/admin/settings', { ...valid, ...keys, turnstileEnabled: 'on' })).status).toBe(302);
      expect(await store().getTurnstileSecret()).toBe('0x4AAAAAAA-secret');
      expect(await store().getSettings()).toMatchObject({ turnstileEnabled: true, turnstileSiteKey: '0x4AAAAAAA-site' });

      html = await (await get('/admin/settings')).text();
      expect(html).not.toContain('0x4AAAAAAA-secret');
      expect(html).toContain('Saved. Leave empty to keep it.');
      expect(html).toContain('class="cf-turnstile" data-sitekey="0x4AAAAAAA-site"'); // the preview

      // An empty secret field keeps the saved secret, without asking Cloudflare again.
      siteverify.mockClear();
      expect((await post('/admin/settings', { ...valid, turnstileSiteKey: keys.turnstileSiteKey, turnstileEnabled: 'on' })).status).toBe(302);
      expect(siteverify).not.toHaveBeenCalled();
      expect(await store().getTurnstileSecret()).toBe('0x4AAAAAAA-secret');
    });

    it('are refused when Cloudflare cannot be asked about the secret', async () => {
      fakeSiteverify().mockRejectedValue(new Error('offline'));
      const res = await post('/admin/settings', { ...valid, ...keys });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Could not reach Cloudflare to check the secret key.');
      expect(await store().hasTurnstileSecret()).toBe(false);
    });
  });

  it('keeps the logo when the rest of the form is rejected', async () => {
    await post('/admin/settings', { ...valid, logo: png('logo.png') });
    const logoId = (await store().getSettings()).logoImageId;
    const res = await post('/admin/settings', { ...valid, storeName: '', removeLogo: 'on' });
    expect(res.status).toBe(400);
    expect((await store().getSettings()).logoImageId).toBe(logoId);
    expect(await store().getImage(logoId!)).not.toBeNull();
  });

  it('refuses non-image uploads', async () => {
    const res = await post('/admin/settings', { ...valid, logo: new File(['hello'], 'x.txt', { type: 'text/plain' }) });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('not a JPEG, PNG, WebP or GIF');
  });
});

describe('admin categories', () => {
  it('creates, edits and deletes a category with an image', async () => {
    let res = await post('/admin/categories', { name: 'Pickles', description: 'Sour & spicy', sortOrder: '2', image: png('pickles.png') });
    expect(res.headers.get('location')).toBe('/admin/categories?flash=created');
    const [cat] = await store().listCategories();
    expect(cat).toMatchObject({ name: 'Pickles', slug: 'pickles', sortOrder: 2 });
    expect(cat?.imageId).toBeTruthy();

    let html = await (await get('/admin/categories')).text();
    expect(html).toContain('Pickles');
    expect(html).toContain('/c/pickles');

    res = await post(`/admin/categories/${cat!.id}`, { name: 'Achar', slug: 'achar', sortOrder: '1', removeImage: 'on' });
    expect(res.headers.get('location')).toBe(`/admin/categories/${cat!.id}?flash=saved`);
    const updated = await store().getCategory(cat!.id);
    expect(updated).toMatchObject({ name: 'Achar', slug: 'achar', sortOrder: 1, imageId: null });
    expect(await store().getImage(cat!.imageId!)).toBeNull();

    html = await (await get(`/admin/categories/${cat!.id}`)).text();
    expect(html).toContain('value="Achar"');
    expect(html).toContain('Delete category');

    res = await post(`/admin/categories/${cat!.id}/delete`, {});
    expect(res.headers.get('location')).toBe('/admin/categories?flash=deleted');
    expect(await store().listCategories()).toHaveLength(0);
    expect((await get(`/admin/categories/${cat!.id}`)).status).toBe(404);
  });

  it('validates the category form', async () => {
    const res = await post('/admin/categories', { name: '', slug: 'Bad Slug!' });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Name is required.');
    expect(html).toContain('lowercase letters, numbers and hyphens');
  });
});

describe('admin products', () => {
  it('creates a product with photos and shows it in the store', async () => {
    const cat = await store().createCategory({ name: 'Sweets' });
    const res = await post('/admin/products', {
      name: 'Mysore Pak',
      description: 'Ghee-rich.',
      price: '249.50',
      compareAtPrice: '299',
      categoryId: cat.id,
      inStock: 'on',
      active: 'on',
      featured: 'on',
      sortOrder: '5',
      images: [png('a.png'), png('b.png')],
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toMatch(/^\/admin\/products\/[0-9a-f-]{36}\?flash=created$/);
    const [product] = await store().listProducts();
    expect(product).toMatchObject({ name: 'Mysore Pak', slug: 'mysore-pak', price: 24950, compareAtPrice: 29900, categoryId: cat.id, inStock: true, active: true, featured: true, sortOrder: 5 });
    expect(product?.imageIds).toHaveLength(2);

    const list = await (await get('/admin/products')).text();
    expect(list).toContain('Mysore Pak');
    expect(list).toContain('Featured');
    expect(list).toContain('₹249.50');

    const storefront = await (await get('/p/mysore-pak')).text();
    expect(storefront).toContain('Mysore Pak');
    expect(storefront).toContain(`/img/${product!.imageIds[0]}`);
  });

  it('edits a product: reorders, removes and adds photos', async () => {
    const [a, b] = await Promise.all([store().putImage('image/png', new ArrayBuffer(4)), store().putImage('image/png', new ArrayBuffer(4))]);
    const product = await store().createProduct({ name: 'Jalebi', price: 10000, imageIds: [a, b] });

    const editPage = await (await get(`/admin/products/${product.id}`)).text();
    expect(editPage).toContain('value="100.00"');
    expect(editPage).toContain(`value="${a}" checked`);

    const res = await post(`/admin/products/${product.id}`, {
      name: 'Jalebi (crispy)',
      price: '120',
      compareAtPrice: '',
      categoryId: '',
      inStock: 'on',
      active: 'on',
      sortOrder: '0',
      primaryImage: b,
      removeImage: a,
      images: png('c.png'),
    });
    expect(res.headers.get('location')).toBe(`/admin/products/${product.id}?flash=saved`);
    const updated = await store().getProduct(product.id);
    expect(updated).toMatchObject({ name: 'Jalebi (crispy)', slug: 'jalebi-crispy', price: 12000, compareAtPrice: null, featured: false });
    expect(updated?.imageIds).toHaveLength(2);
    expect(updated?.imageIds[0]).toBe(b);
    expect(await store().getImage(a)).toBeNull();
  });

  it('validates prices and rejects oversized photos', async () => {
    let res = await post('/admin/products', { name: '', price: 'abc', compareAtPrice: 'xyz' });
    expect(res.status).toBe(400);
    let html = await res.text();
    expect(html).toContain('Name is required.');
    expect(html).toContain('Enter a price');
    expect(html).toContain('Enter an amount or leave empty.');

    res = await post('/admin/products', { name: 'Big', price: '10', images: png('huge.png', 1_700_000) });
    expect(res.status).toBe(400);
    html = await res.text();
    expect(html).toContain('too large');
    expect(await store().listProducts()).toHaveLength(0);
  });

  it('filters the list and deletes products with their photos', async () => {
    const cat = await store().createCategory({ name: 'Snacks' });
    const img = await store().putImage('image/png', new ArrayBuffer(4));
    const murukku = await store().createProduct({ name: 'Murukku', price: 5000, categoryId: cat.id, imageIds: [img] });
    await store().createProduct({ name: 'Loose tea', price: 8000 });

    expect(await (await get(`/admin/products?category=${cat.id}`)).text()).not.toContain('Loose tea');
    expect(await (await get('/admin/products?category=none')).text()).not.toContain('Murukku');
    expect(await (await get('/admin/products?q=tea')).text()).toContain('Loose tea');

    const res = await post(`/admin/products/${murukku.id}/delete`, {});
    expect(res.headers.get('location')).toBe('/admin/products?flash=deleted');
    expect(await store().getProduct(murukku.id)).toBeNull();
    expect(await store().getImage(img)).toBeNull();
    expect((await get(`/admin/products/${murukku.id}`)).status).toBe(404);
  });
});
