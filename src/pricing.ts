import type { Settings } from './types';

type DeliveryRules = Pick<Settings, 'deliveryFee' | 'freeDeliveryOver'>;

export function deliveryFeeFor(subtotal: number, rules: DeliveryRules): number {
  const free = rules.freeDeliveryOver !== null && subtotal >= rules.freeDeliveryOver;
  return free ? 0 : rules.deliveryFee;
}

export interface Totals {
  subtotal: number;
  deliveryFee: number;
  total: number;
}

/** Sums priced lines and applies the store's delivery rules. Used by the DO and the checkout preview alike. */
export function computeTotals(lines: { price: number; qty: number }[], rules: DeliveryRules): Totals {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const deliveryFee = deliveryFeeFor(subtotal, rules);
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}
