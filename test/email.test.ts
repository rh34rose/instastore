import { env } from 'cloudflare:workers';
import { createExecutionContext, reset, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORE_INSTANCE_NAME } from '../src/app';
import {
  canSendCodes,
  canTakeOrders,
  customerConfirmation,
  ownerNotification,
  sendOrderEmails,
  sendVerificationCode,
  verificationCodeEmail,
} from '../src/email';
import app from '../src/index';
import { DEFAULT_SETTINGS, type Order, type Settings } from '../src/types';
import { Outbox, Session } from './helpers/session';

const settings: Settings = { ...DEFAULT_SETTINGS, storeName: 'Amma Pickles', notifyEmail: 'owner@example.com', fromEmail: 'orders@ammapickles.in', fromName: 'Amma', contactPhone: '9876543210' };

const order: Order = {
  id: 'o-1',
  number: 1001,
  status: 'new',
  customer: { name: 'Asha', phone: '+91 98765 43210', email: 'asha@example.com', address: '12 MG Road\nKochi' },
  notes: 'Ring twice',
  items: [
    { productId: 'p1', name: 'Mango pickle <hot>', price: 25000, qty: 2, imageId: null },
    { productId: 'p2', name: 'Lime pickle', price: 20000, qty: 1, imageId: null },
  ],
  subtotal: 70000,
  deliveryFee: 5000,
  total: 75000,
  currency: 'INR',
  paymentMethod: 'cod',
  notification: 'pending',
  createdAt: 0,
  updatedAt: 0,
};

describe('email content', () => {
  it('tells the owner everything needed to fulfil the order', () => {
    const mail = ownerNotification(order, settings, 'https://shop.example.com/admin/orders/o-1');
    expect(mail.subject).toBe('New order #1001 — ₹750.00');
    expect(mail.text).toContain('2 × Mango pickle <hot> — ₹500.00');
    expect(mail.text).toContain('Total (cash on delivery): ₹750.00');
    expect(mail.text).toContain('12 MG Road\nKochi');
    expect(mail.text).toContain('Notes: Ring twice');
    expect(mail.text).toContain('https://shop.example.com/admin/orders/o-1');
    expect(mail.html).toContain('Mango pickle &lt;hot&gt;');
    expect(mail.html).not.toContain('<hot>');
  });

  it('confirms the order to the customer with a link back', () => {
    const mail = customerConfirmation(order, settings, 'https://shop.example.com/order/o-1');
    expect(mail.subject).toBe('Amma Pickles: order #1001 received');
    expect(mail.text).toContain('Hi Asha,');
    expect(mail.text).toContain(DEFAULT_SETTINGS.thankYouMessage);
    expect(mail.text).toContain('https://shop.example.com/order/o-1');
    expect(mail.text).toContain('Questions? 9876543210');
  });
});

describe('sendOrderEmails', () => {
  it('sends to the owner and the customer', async () => {
    const sender = new Outbox();
    const outcome = await sendOrderEmails(sender, order, settings, 'https://shop.example.com');
    expect(outcome.notification).toBe('sent');
    expect(sender.sent.map((m) => m.to)).toEqual(['owner@example.com', 'asha@example.com']);
    expect(sender.sent[0]?.from).toEqual({ email: 'orders@ammapickles.in', name: 'Amma' });
    expect(sender.sent[0]?.replyTo).toBe('asha@example.com');
    expect(sender.sent[1]?.replyTo).toBe('owner@example.com');
  });

  it('skips cleanly when not configured', async () => {
    const sender = new Outbox();
    expect((await sendOrderEmails(undefined, order, settings, 'x')).notification).toContain('skipped: EMAIL binding');
    expect((await sendOrderEmails(sender, order, { ...settings, fromEmail: '' }, 'x')).notification).toContain('skipped: no sender');
    expect((await sendOrderEmails(sender, order, { ...settings, notifyEmail: '' }, 'x')).notification).toContain('skipped: no notification');
    expect(sender.sent).toHaveLength(0);
  });

  it('reports the binding error code when the owner email fails', async () => {
    const sender = new Outbox();
    sender.failWith['owner@example.com'] = 'E_SENDER_NOT_VERIFIED';
    expect((await sendOrderEmails(sender, order, settings, 'x')).notification).toBe('failed: E_SENDER_NOT_VERIFIED');
  });

  it('still counts as sent when only the customer copy fails', async () => {
    const sender = new Outbox();
    sender.failWith['asha@example.com'] = 'E_RECIPIENT_SUPPRESSED';
    expect((await sendOrderEmails(sender, order, settings, 'x')).notification).toBe('sent (customer copy failed: E_RECIPIENT_SUPPRESSED)');
  });

  it('does not email the customer without an address', async () => {
    const sender = new Outbox();
    await sendOrderEmails(sender, { ...order, customer: { ...order.customer, email: null } }, settings, 'x');
    expect(sender.sent.map((m) => m.to)).toEqual(['owner@example.com']);
  });
});

describe('checkout codes', () => {
  it('puts the code up front and says how long it works', () => {
    const mail = verificationCodeEmail('042917', { ...settings, storeName: 'Amma <Pickles>' }, 10);
    expect(mail.subject).toBe('042917 is your Amma <Pickles> code');
    expect(mail.text).toContain('\n042917\n');
    expect(mail.text).toContain('works for 10 minutes');
    expect(mail.html).toContain('>042917</p>');
    expect(mail.html).toContain('Amma &lt;Pickles&gt;');
  });

  it('sends from the store sender, with replies going to the store', async () => {
    const sender = new Outbox();
    expect(await sendVerificationCode(sender, settings, 'asha@example.com', '042917', 10)).toEqual({ ok: true });
    expect(sender.sent[0]).toMatchObject({ to: 'asha@example.com', from: { email: 'orders@ammapickles.in', name: 'Amma' }, replyTo: 'owner@example.com' });

    await sendVerificationCode(sender, { ...settings, notifyEmail: '' }, 'asha@example.com', '042917', 10);
    expect(sender.sent[1]).not.toHaveProperty('replyTo');
  });

  it('reports failures, telling address problems apart from store problems', async () => {
    const sender = new Outbox();
    sender.failWith['gone@example.com'] = 'E_RECIPIENT_SUPPRESSED';
    sender.failWith['asha@example.com'] = 'E_SENDER_NOT_VERIFIED';
    expect(await sendVerificationCode(sender, settings, 'gone@example.com', '042917', 10)).toEqual({ ok: false, error: 'E_RECIPIENT_SUPPRESSED', addressProblem: true });
    expect(await sendVerificationCode(sender, settings, 'asha@example.com', '042917', 10)).toEqual({ ok: false, error: 'E_SENDER_NOT_VERIFIED', addressProblem: false });
  });

  it('needs the binding and a sender address, but not the owner inbox', () => {
    const sender = new Outbox();
    expect(canSendCodes(sender, { ...settings, notifyEmail: '' })).toBe(true);
    expect(canSendCodes(sender, { ...settings, fromEmail: '' })).toBe(false);
    expect(canSendCodes(undefined, settings)).toBe(false);
  });

  it('only holds up orders when email confirmation is on', () => {
    const noSender = { ...settings, fromEmail: '' };
    expect(canTakeOrders(undefined, noSender)).toBe(true);
    expect(canTakeOrders(undefined, { ...noSender, confirmEmail: true })).toBe(false);
    expect(canTakeOrders(new Outbox(), { ...settings, confirmEmail: true })).toBe(true);
  });
});

describe('checkout wiring', () => {
  beforeEach(() => reset());

  it('emails after an order is placed and records the outcome on the order', async () => {
    const store = env.STORE.getByName(STORE_INSTANCE_NAME);
    await store.updateSettings({ notifyEmail: 'owner@example.com', fromEmail: 'orders@ammapickles.in', confirmEmail: true });
    const product = await store.createProduct({ name: 'Thing', price: 1000 });
    const shopper = new Session();

    await shopper.post('/cart/add', { productId: product.id, qty: '1' });
    await shopper.post('/checkout', { name: 'Asha Menon', phone: '9876543210', email: 'asha@example.com', address: '12 MG Road, Kochi', notes: '' });
    const res = await shopper.post('/checkout/verify', { code: shopper.outbox.codeFor('asha@example.com') });
    expect(res.status).toBe(302);

    // The confirmation code first, then the order emails once the order exists.
    expect(shopper.outbox.sent.map((m) => m.to)).toEqual(['asha@example.com', 'owner@example.com', 'asha@example.com']);
    expect(shopper.outbox.sent[1]?.subject).toBe('New order #1001 — ₹10.00');
    const [order] = await store.listOrders();
    expect(order?.notification).toBe('sent');
  });

  it('sends a test email from settings and explains failures', async () => {
    const store = env.STORE.getByName(STORE_INSTANCE_NAME);
    const vars = { ACCESS_DEV_BYPASS: 'true' };
    const sender = new Outbox();
    const base = 'http://localhost:8787';
    const post = async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(new Request(`${base}/admin/settings/test-email`, { method: 'POST', redirect: 'manual' }), { ...env, ...vars, EMAIL: sender as SendEmail }, ctx);
      await waitOnExecutionContext(ctx);
      return res;
    };

    expect((await post()).headers.get('location')).toBe('/admin/settings?flash=email-not-configured');

    await store.updateSettings({ notifyEmail: 'owner@example.com', fromEmail: 'orders@ammapickles.in' });
    expect((await post()).headers.get('location')).toBe('/admin/settings?flash=email-sent');
    expect(sender.sent[0]).toMatchObject({ to: 'owner@example.com', from: { email: 'orders@ammapickles.in', name: 'My Store' } });

    sender.failWith['owner@example.com'] = 'E_SENDER_NOT_VERIFIED';
    const failed = await post();
    expect(failed.status).toBe(502);
    const html = await failed.text();
    expect(html).toContain('E_SENDER_NOT_VERIFIED');
    expect(html).toContain('not onboarded to Email Sending');
  });
});
