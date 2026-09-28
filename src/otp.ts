/**
 * One-time codes that prove a shopper owns the email address they order
 * with. Checkout emails a code, and the order is placed only once the
 * shopper types it back.
 *
 * What makes a code hard to guess is its short life and the limits below,
 * not how it is stored: the Durable Object keeps codes as plain text,
 * because hashing a six-digit number protects nothing — anyone holding the
 * hash can try all million candidates in an instant.
 */

export const OTP_DIGITS = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_TTL_MS = OTP_TTL_MINUTES * 60 * 1000;
/** Wrong guesses allowed per code; after that the shopper needs a new one. */
export const OTP_MAX_ATTEMPTS = 5;
/** Minimum gap between two codes for the same checkout. */
export const OTP_RESEND_INTERVAL_MS = 30 * 1000;
/** Codes one address can receive in an hour, across all checkouts. Keeps anyone's inbox from being flooded. */
export const OTP_MAX_PER_ADDRESS_PER_HOUR = 5;
/** How long checkout details wait after their latest code before the shopper has to start over. */
export const PENDING_CHECKOUT_TTL_MS = 60 * 60 * 1000;

const RANGE = 10 ** OTP_DIGITS;
/** Largest multiple of RANGE below 2^32. Draws at or above it are retried, so every code is equally likely. */
const UNBIASED_LIMIT = Math.floor(2 ** 32 / RANGE) * RANGE;
const OTP_RE = new RegExp(`^[0-9]{${OTP_DIGITS}}$`);

export function generateOtp(): string {
  const draw = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(draw);
    n = draw[0]!;
  } while (n >= UNBIASED_LIMIT);
  return String(n % RANGE).padStart(OTP_DIGITS, '0');
}

/**
 * Reads a code the way people type it: "123 456", "123-456" and full-width
 * digits from phone keyboards are all fine. Returns null unless it is a
 * complete code.
 */
export function parseOtp(input: string): string | null {
  const digits = input.normalize('NFKC').replace(/[\s-]/g, '');
  return OTP_RE.test(digits) ? digits : null;
}
