/** Small helpers for reading HTML form submissions safely. */

export function text(form: FormData, name: string, max = 1000): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : '';
}

export function integer(form: FormData, name: string, fallback = 0): number {
  const value = Number(text(form, name, 20));
  return Number.isInteger(value) ? value : fallback;
}

export function checkbox(form: FormData, name: string): boolean {
  const value = form.get(name);
  return value === 'on' || value === '1' || value === 'true';
}

export function files(form: FormData, name: string): File[] {
  return form.getAll(name).filter((v): v is File => v instanceof File && v.size > 0);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

const PHONE_RE = /^\+?[0-9][0-9 ()-]{4,19}$/;
export function isPhone(value: string): boolean {
  return PHONE_RE.test(value);
}

/** Only allow redirects back into this site. */
export function safeReturnPath(value: string, fallback: string): string {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : fallback;
}
