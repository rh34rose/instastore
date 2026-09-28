import { formatMoney } from './money';
import type { Order, Settings } from './types';

/**
 * Store emails through the Cloudflare Email Sending binding.
 *
 * Order emails are best-effort: an order is saved before any email goes
 * out, and failures are recorded on the order (visible in the admin) rather
 * than shown to the shopper. Checkout codes are the opposite: the shopper
 * is waiting for one, so a failure is reported straight back to them.
 */

/** The part of the SendEmail binding we use, so tests can pass a fake. */
export type EmailSender = { send(message: EmailMessageBuilder): Promise<EmailSendResult> };

export interface EmailOutcome {
  /** Stored on the order: "sent", "skipped: …" or "failed: …". */
  notification: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return err instanceof Error ? err.message : String(err);
}

function sender(settings: Settings): { email: string; name: string } {
  return { email: settings.fromEmail, name: settings.fromName || settings.storeName };
}

function itemLines(order: Order, settings: Settings): string[] {
  const money = (n: number) => formatMoney(n, order.currency, settings.locale);
  const lines = order.items.map((i) => `${i.qty} × ${i.name} — ${money(i.price * i.qty)}`);
  lines.push(`Subtotal: ${money(order.subtotal)}`);
  lines.push(`Delivery: ${order.deliveryFee === 0 ? 'Free' : money(order.deliveryFee)}`);
  lines.push(`Total (cash on delivery): ${money(order.total)}`);
  return lines;
}

function itemsHtml(order: Order, settings: Settings): string {
  const money = (n: number) => formatMoney(n, order.currency, settings.locale);
  const rows = order.items
    .map((i) => `<tr><td style="padding:4px 8px">${escapeHtml(i.name)}</td><td style="padding:4px 8px;text-align:right">${i.qty}</td><td style="padding:4px 8px;text-align:right">${escapeHtml(money(i.price * i.qty))}</td></tr>`)
    .join('');
  const totals = [
    ['Subtotal', money(order.subtotal)],
    ['Delivery', order.deliveryFee === 0 ? 'Free' : money(order.deliveryFee)],
    ['<strong>Total (cash on delivery)</strong>', `<strong>${escapeHtml(money(order.total))}</strong>`],
  ]
    .map(([label, value]) => `<tr><td colspan="2" style="padding:4px 8px;text-align:right">${label}</td><td style="padding:4px 8px;text-align:right">${value}</td></tr>`)
    .join('');
  return `<table style="border-collapse:collapse;min-width:320px"><thead><tr><th style="text-align:left;padding:4px 8px">Item</th><th style="padding:4px 8px">Qty</th><th style="text-align:right;padding:4px 8px">Amount</th></tr></thead><tbody>${rows}${totals}</tbody></table>`;
}

function customerBlock(order: Order): { text: string; html: string } {
  const c = order.customer;
  const text = [c.name, c.phone, c.email ?? '', c.address, order.notes ? `Notes: ${order.notes}` : ''].filter(Boolean).join('\n');
  const html = `<p>${escapeHtml(c.name)}<br>${escapeHtml(c.phone)}${c.email ? `<br>${escapeHtml(c.email)}` : ''}</p><p style="white-space:pre-line">${escapeHtml(c.address)}</p>${
    order.notes ? `<p><em>Notes:</em> ${escapeHtml(order.notes)}</p>` : ''
  }`;
  return { text, html };
}

function wrap(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#1c1917;line-height:1.5;max-width:600px;margin:0 auto;padding:16px"><h1 style="font-size:20px">${escapeHtml(title)}</h1>${body}</body></html>`;
}

export function ownerNotification(order: Order, settings: Settings, adminUrl: string) {
  const customer = customerBlock(order);
  const subject = `New order #${order.number} — ${formatMoney(order.total, order.currency, settings.locale)}`;
  const text = [
    `You have a new cash-on-delivery order at ${settings.storeName}.`,
    '',
    `Order #${order.number}`,
    ...itemLines(order, settings),
    '',
    'Deliver to:',
    customer.text,
    '',
    `Manage this order: ${adminUrl}`,
  ].join('\n');
  const html = wrap(
    `New order #${order.number}`,
    `<p>You have a new cash-on-delivery order at ${escapeHtml(settings.storeName)}.</p>${itemsHtml(order, settings)}<h2 style="font-size:16px">Deliver to</h2>${customer.html}<p><a href="${escapeHtml(adminUrl)}">Manage this order</a></p>`,
  );
  return { subject, text, html };
}

export function customerConfirmation(order: Order, settings: Settings, orderUrl: string) {
  const customer = customerBlock(order);
  const subject = `${settings.storeName}: order #${order.number} received`;
  const contact = [settings.contactPhone, settings.contactEmail].filter(Boolean).join(' · ');
  const text = [
    `Hi ${order.customer.name},`,
    '',
    `Thanks for your order at ${settings.storeName}. ${settings.thankYouMessage}`,
    '',
    `Order #${order.number}`,
    ...itemLines(order, settings),
    '',
    'Delivering to:',
    customer.text,
    '',
    `View your order: ${orderUrl}`,
    contact ? `Questions? ${contact}` : '',
  ].join('\n');
  const html = wrap(
    `Thanks for your order, ${order.customer.name}!`,
    `<p>${escapeHtml(settings.thankYouMessage)}</p><p><strong>Order #${order.number}</strong> · pay ${escapeHtml(
      formatMoney(order.total, order.currency, settings.locale),
    )} in cash on delivery.</p>${itemsHtml(order, settings)}<h2 style="font-size:16px">Delivering to</h2>${customer.html}<p><a href="${escapeHtml(orderUrl)}">View your order</a></p>${
      contact ? `<p>Questions? ${escapeHtml(contact)}</p>` : ''
    }`,
  );
  return { subject, text, html };
}

/**
 * Emails the owner and (if they gave an address) the customer.
 * Returns what to record on the order.
 */
export async function sendOrderEmails(email: EmailSender | undefined, order: Order, settings: Settings, origin: string): Promise<EmailOutcome> {
  if (!email) return { notification: 'skipped: EMAIL binding not configured' };
  if (!settings.fromEmail) return { notification: 'skipped: no sender address in settings' };
  if (!settings.notifyEmail) return { notification: 'skipped: no notification address in settings' };

  const from = sender(settings);
  const owner = ownerNotification(order, settings, `${origin}/admin/orders/${order.id}`);
  try {
    await email.send({ to: settings.notifyEmail, from, ...(order.customer.email ? { replyTo: order.customer.email } : {}), subject: owner.subject, text: owner.text, html: owner.html });
  } catch (err) {
    const code = errorCode(err);
    console.error(JSON.stringify({ message: 'order notification failed', orderId: order.id, error: code }));
    return { notification: `failed: ${code}` };
  }

  if (order.customer.email) {
    const confirmation = customerConfirmation(order, settings, `${origin}/order/${order.id}`);
    try {
      await email.send({ to: order.customer.email, from, replyTo: settings.contactEmail || settings.notifyEmail, subject: confirmation.subject, text: confirmation.text, html: confirmation.html });
    } catch (err) {
      const code = errorCode(err);
      console.error(JSON.stringify({ message: 'customer confirmation failed', orderId: order.id, error: code }));
      return { notification: `sent (customer copy failed: ${code})` };
    }
  }
  return { notification: 'sent' };
}

/** Codes need the binding and a sender address; the owner's notification address is optional for them. */
export function canSendCodes(email: EmailSender | undefined, settings: Settings): boolean {
  return email !== undefined && settings.fromEmail !== '';
}

/** Checkout is open unless the store confirms shoppers' emails and cannot send the codes. */
export function canTakeOrders(email: EmailSender | undefined, settings: Settings): boolean {
  return !settings.confirmEmail || canSendCodes(email, settings);
}

export function verificationCodeEmail(otp: string, settings: Settings, minutes: number) {
  // The code leads the subject so it shows in inbox previews and phone notifications.
  const subject = `${otp} is your ${settings.storeName} code`;
  const expiry = `The code works for ${minutes} minutes. If you did not try to order from ${settings.storeName}, you can ignore this email.`;
  const text = [`Your code to confirm your order at ${settings.storeName} is:`, '', otp, '', expiry].join('\n');
  const html = wrap(
    'Confirm your order',
    `<p>Your code to confirm your order at ${escapeHtml(settings.storeName)} is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${escapeHtml(otp)}</p><p>${escapeHtml(expiry)}</p>`,
  );
  return { subject, text, html };
}

/** Email Sending errors that point at the shopper's address rather than at the store's setup. */
const ADDRESS_ERRORS = new Set(['E_RECIPIENT_SUPPRESSED', 'E_DELIVERY_FAILED', 'E_VALIDATION_ERROR']);

export type CodeSendOutcome = { ok: true } | { ok: false; error: string; addressProblem: boolean };

/** Emails a checkout code. Never throws: the caller tells the shopper what went wrong. */
export async function sendVerificationCode(email: EmailSender, settings: Settings, to: string, otp: string, minutes: number): Promise<CodeSendOutcome> {
  const mail = verificationCodeEmail(otp, settings, minutes);
  const replyTo = settings.contactEmail || settings.notifyEmail;
  try {
    await email.send({ to, from: sender(settings), ...(replyTo ? { replyTo } : {}), subject: mail.subject, text: mail.text, html: mail.html });
    return { ok: true };
  } catch (err) {
    const code = errorCode(err);
    console.error(JSON.stringify({ message: 'verification code email failed', error: code }));
    return { ok: false, error: code, addressProblem: ADDRESS_ERRORS.has(code) };
  }
}

/** Used by the "Send test email" button in settings. Throws with the binding's error code on failure. */
export async function sendTestEmail(email: EmailSender, settings: Settings, origin: string): Promise<void> {
  const from = sender(settings);
  await email.send({
    to: settings.notifyEmail,
    from,
    subject: `${settings.storeName}: test email`,
    text: `Order emails from ${settings.storeName} (${origin}) are working. New orders will arrive at this address.`,
    html: wrap('Test email', `<p>Order emails from ${escapeHtml(settings.storeName)} (${escapeHtml(origin)}) are working.</p><p>New orders will arrive at this address.</p>`),
  });
}
