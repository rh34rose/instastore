/**
 * Domain types shared by the Durable Object, the routes and the views.
 *
 * All money values are integers in the currency's minor unit (paise, cents…).
 * All timestamps are Unix epoch milliseconds.
 */

export type OrderStatus = 'new' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';

export const ORDER_STATUSES: readonly OrderStatus[] = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export interface Settings {
  storeName: string;
  tagline: string;
  /** Free text shown on the home page and used as the meta description. */
  description: string;
  /** ISO 4217 code, e.g. "INR", "USD". */
  currency: string;
  /** BCP 47 locale used for number formatting, e.g. "en-IN". */
  locale: string;
  /** Hex colour used for buttons and links. */
  accentColor: string;
  logoImageId: string | null;
  /** Short banner shown at the top of every storefront page. Empty hides it. */
  announcement: string;
  /** When false the storefront shows `closedMessage` and refuses new orders. */
  storeOpen: boolean;
  closedMessage: string;
  contactPhone: string;
  contactEmail: string;
  contactAddress: string;
  /** Flat delivery charge added to every order (minor units). */
  deliveryFee: number;
  /** Orders with a subtotal at or above this amount get free delivery. null = never. */
  freeDeliveryOver: number | null;
  /** Shown on the checkout page, e.g. delivery areas or timings. */
  checkoutNote: string;
  /** Shown on the order confirmation page. */
  thankYouMessage: string;
  /** Address that receives a notification for every new order. */
  notifyEmail: string;
  /** Sender address; must belong to a domain onboarded to Cloudflare Email Sending. */
  fromEmail: string;
  fromName: string;
  /** Shoppers confirm their email with a one-time code before an order is placed. Needs email sending. */
  confirmEmail: boolean;
  /** Checkout asks shoppers to pass a Cloudflare Turnstile check. The widget's secret key is stored apart from settings. */
  turnstileEnabled: boolean;
  /** Public site key of the store's Turnstile widget. */
  turnstileSiteKey: string;
}

export const DEFAULT_SETTINGS: Settings = {
  storeName: 'My Store',
  tagline: 'Good things, delivered to your door.',
  description: '',
  currency: 'INR',
  locale: 'en-IN',
  accentColor: '#1f6f5f',
  logoImageId: null,
  announcement: '',
  storeOpen: true,
  closedMessage: 'We are not taking orders right now. Please check back soon.',
  contactPhone: '',
  contactEmail: '',
  contactAddress: '',
  deliveryFee: 0,
  freeDeliveryOver: null,
  checkoutNote: '',
  thankYouMessage: 'Thank you for your order! We will contact you shortly to confirm delivery.',
  notifyEmail: '',
  fromEmail: '',
  fromName: '',
  // Off until the owner turns it on: with it on, orders depend on email sending working.
  confirmEmail: false,
  turnstileEnabled: false,
  turnstileSiteKey: '',
};

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface CategoryInput {
  name: string;
  /** Empty or missing → generated from the name. */
  slug?: string;
  description?: string;
  imageId?: string | null;
  sortOrder?: number;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  /** Original price shown struck through when higher than `price`. */
  compareAtPrice: number | null;
  categoryId: string | null;
  imageIds: string[];
  inStock: boolean;
  featured: boolean;
  /** Inactive products are hidden from the storefront and cannot be ordered. */
  active: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProductInput {
  name: string;
  slug?: string;
  description?: string;
  price: number;
  compareAtPrice?: number | null;
  categoryId?: string | null;
  imageIds?: string[];
  inStock?: boolean;
  featured?: boolean;
  active?: boolean;
  sortOrder?: number;
}

export interface ProductFilter {
  categoryId?: string | null;
  activeOnly?: boolean;
  featuredOnly?: boolean;
  /** Case-insensitive substring match on the product name. */
  query?: string;
  limit?: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  /** Unit price at the time of ordering. */
  price: number;
  qty: number;
  imageId: string | null;
}

export interface OrderCustomer {
  name: string;
  phone: string;
  email: string | null;
  address: string;
}

export interface Order {
  id: string;
  /** Human-friendly sequential number, starts at 1001. */
  number: number;
  status: OrderStatus;
  customer: OrderCustomer;
  notes: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  currency: string;
  paymentMethod: 'cod';
  /** Outcome of the notification email: "pending", "sent", "skipped: …" or "failed: …". */
  notification: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlaceOrderInput {
  customer: OrderCustomer;
  notes?: string;
  items: { productId: string; qty: number }[];
}

export type PlaceOrderResult =
  | { ok: true; order: Order }
  | { ok: false; code: 'closed' | 'empty' | 'unavailable'; message: string };

export interface CheckoutInput {
  customer: OrderCustomer;
  notes?: string;
}

/** Checkout details waiting for the shopper to confirm their email address with a code. */
export interface PendingCheckout {
  id: string;
  /** What the shopper entered; the code goes to `email`. */
  customer: OrderCustomer & { email: string };
  notes: string;
  /** When the latest code stops working. */
  codeExpiresAt: number;
  /** Wrong guesses left for the latest code. */
  attemptsLeft: number;
  /** When the shopper may ask for another code. */
  resendAt: number;
}

/** A code for the route to email, or why none was issued. */
export type IssueCodeResult =
  | { ok: true; pending: PendingCheckout; otp: string }
  | { ok: false; code: 'missing' | 'too_soon' | 'rate_limited'; message: string };

export type ConfirmCheckoutResult =
  | PlaceOrderResult
  | { ok: false; code: 'missing' | 'expired' | 'locked' | 'wrong_code'; message: string };

export interface StoreStats {
  products: number;
  activeProducts: number;
  categories: number;
  orders: Record<OrderStatus, number>;
}
