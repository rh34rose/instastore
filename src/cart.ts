import { MAX_ORDER_LINES, MAX_ORDER_QTY } from './store';

/**
 * The cart lives in a cookie so the storefront works without JavaScript.
 * Format: "productId:qty|productId:qty". Product ids are UUIDs, so 50 lines
 * stay well under the 4 KB cookie limit.
 */
export const CART_COOKIE = 'cart';
export const CART_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type CartLines = Map<string, number>;

const ID_RE = /^[0-9a-f-]{36}$/;

export function parseCart(raw: string | undefined | null): CartLines {
  const lines: CartLines = new Map();
  if (!raw) return lines;
  for (const part of raw.split('|')) {
    const [id, qtyText] = part.split(':');
    const qty = Number(qtyText);
    if (!id || !ID_RE.test(id) || !Number.isInteger(qty) || qty < 1) continue;
    lines.set(id, Math.min(qty, MAX_ORDER_QTY));
    if (lines.size >= MAX_ORDER_LINES) break;
  }
  return lines;
}

export function serializeCart(lines: CartLines): string {
  return [...lines].map(([id, qty]) => `${id}:${qty}`).join('|');
}

export function cartCount(lines: CartLines): number {
  let count = 0;
  for (const qty of lines.values()) count += qty;
  return count;
}

/** Sets a line's quantity; 0 removes it. Returns the same map for chaining. */
export function setCartLine(lines: CartLines, productId: string, qty: number): CartLines {
  if (!ID_RE.test(productId)) return lines;
  if (qty < 1) lines.delete(productId);
  else if (lines.has(productId) || lines.size < MAX_ORDER_LINES) lines.set(productId, Math.min(Math.floor(qty), MAX_ORDER_QTY));
  return lines;
}
