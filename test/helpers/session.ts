/** Test helpers: a fake EMAIL binding and a shopper with a cookie jar. */
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import type { EmailSender } from '../../src/email';
import app from '../../src/index';

export const BASE = 'https://shop.example.com';

/** Stands in for the EMAIL binding: keeps what was sent, or fails for the addresses in `failWith`. */
export class Outbox implements EmailSender {
  sent: EmailMessageBuilder[] = [];
  failWith: Record<string, string> = {};

  async send(message: EmailMessageBuilder) {
    const to = String(message.to);
    if (this.failWith[to]) throw Object.assign(new Error('boom'), { code: this.failWith[to] });
    this.sent.push(message);
    return { messageId: `m-${this.sent.length}` };
  }

  /** The code in the latest email to `to`, read from the text the shopper would see. */
  codeFor(to: string): string {
    const mail = this.sent.filter((m) => String(m.to) === to).at(-1);
    const code = mail?.text?.match(/^([0-9]{6})$/m)?.[1];
    if (!code) throw new Error(`no code was emailed to ${to}`);
    return code;
  }
}

/** Minimal cookie jar so a test can behave like one shopper across requests. */
export class Session {
  cookies = new Map<string, string>();

  constructor(readonly outbox = new Outbox()) {}

  async fetch(path: string, init: RequestInit & { form?: Record<string, string> } = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    let body = init.body;
    if (init.form) {
      body = new URLSearchParams(init.form);
      headers.set('content-type', 'application/x-www-form-urlencoded');
    }
    const ctx = createExecutionContext();
    const res = await app.fetch(new Request(`${BASE}${path}`, { ...init, headers, body, redirect: 'manual' }), { ...env, EMAIL: this.outbox as SendEmail }, ctx);
    await waitOnExecutionContext(ctx);
    for (const setCookie of res.headers.getSetCookie()) {
      const [pair, ...attrs] = setCookie.split(';');
      const [name, value] = pair!.split('=');
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
      if (expired) this.cookies.delete(name!);
      else this.cookies.set(name!, value ?? '');
    }
    return res;
  }

  post(path: string, form: Record<string, string>) {
    return this.fetch(path, { method: 'POST', form });
  }
}
