/**
 * Money helpers. Amounts are integers in the currency's minor unit.
 */

const FALLBACK_DIGITS = 2;

/** Number of decimal places the currency uses (2 for INR/USD, 0 for JPY, …). */
export function currencyFractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? FALLBACK_DIGITS;
  } catch {
    return FALLBACK_DIGITS;
  }
}

/** Format minor units as a localized currency string, e.g. 123456 → "₹1,234.56". */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const digits = currencyFractionDigits(currency);
  const major = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(major);
  } catch {
    return `${currency} ${major.toFixed(digits)}`;
  }
}

/** Minor units → decimal string for form inputs, e.g. 123456 → "1234.56". */
export function toMajorString(minor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

/**
 * Parse a decimal amount typed by a human ("1,234.50", "99") into minor units.
 * Returns null for anything that is not a non-negative number.
 */
export function parseMoney(input: string, currency: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '');
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const digits = currencyFractionDigits(currency);
  const [whole = '0', frac = ''] = cleaned.split('.');
  const paddedFrac = (frac + '0'.repeat(digits)).slice(0, digits);
  const value = Number(whole) * 10 ** digits + (digits > 0 ? Number(paddedFrac) : 0);
  return Number.isSafeInteger(value) ? value : null;
}
