import { DurableObject } from 'cloudflare:workers';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_ADDRESS_PER_HOUR,
  OTP_RESEND_INTERVAL_MS,
  OTP_TTL_MS,
  PENDING_CHECKOUT_TTL_MS,
  generateOtp,
} from './otp';
import { computeTotals } from './pricing';
import { slugify } from './slug';
import {
  DEFAULT_SETTINGS,
  ORDER_STATUSES,
  type Category,
  type CategoryInput,
  type CheckoutInput,
  type ConfirmCheckoutResult,
  type IssueCodeResult,
  type Order,
  type OrderCustomer,
  type OrderItem,
  type OrderStatus,
  type PendingCheckout,
  type PlaceOrderInput,
  type PlaceOrderResult,
  type Product,
  type ProductFilter,
  type ProductInput,
  type Settings,
  type StoreStats,
} from './types';

/**
 * StoreDO holds everything a store owns — settings, catalog, images, orders
 * and checkouts waiting for an email code — in one SQLite-backed Durable
 * Object. A single instance per store
 * gives strong consistency (what the admin saves is what shoppers see) with
 * zero resources to provision: no KV namespaces, D1 databases or R2 buckets.
 *
 * Images live here too, as blobs. That keeps setup at "push to deploy" and
 * is plenty for a small catalog; the Worker caches them at the edge.
 *
 * Expected outcomes (not found, cart problems) are returned as values, never
 * thrown: errors do not cross the RPC boundary gracefully. The few `throw`s
 * left are safety nets for input the route layer should have validated.
 */

export const MAX_IMAGE_BYTES = 1_600_000; // DO SQLite rows are capped at 2 MB
export const MAX_ORDER_QTY = 99;
export const MAX_ORDER_LINES = 50;
const FIRST_ORDER_NUMBER = 1001;
const HOUR_MS = 60 * 60 * 1000;
const CHECKOUT_MISSING = { ok: false, code: 'missing', message: 'Your checkout expired. Please enter your details again.' } as const;

const MIGRATIONS: string[] = [
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   CREATE TABLE categories (
     id TEXT PRIMARY KEY,
     slug TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     image_id TEXT,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE products (
     id TEXT PRIMARY KEY,
     slug TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     price INTEGER NOT NULL,
     compare_at_price INTEGER,
     category_id TEXT,
     image_ids TEXT NOT NULL DEFAULT '[]',
     in_stock INTEGER NOT NULL DEFAULT 1,
     featured INTEGER NOT NULL DEFAULT 0,
     active INTEGER NOT NULL DEFAULT 1,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX products_by_category ON products (category_id, sort_order);
   CREATE TABLE images (
     id TEXT PRIMARY KEY,
     content_type TEXT NOT NULL,
     size INTEGER NOT NULL,
     data BLOB NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE orders (
     id TEXT PRIMARY KEY,
     number INTEGER NOT NULL UNIQUE,
     status TEXT NOT NULL,
     customer TEXT NOT NULL,
     notes TEXT NOT NULL DEFAULT '',
     items TEXT NOT NULL,
     subtotal INTEGER NOT NULL,
     delivery_fee INTEGER NOT NULL,
     total INTEGER NOT NULL,
     currency TEXT NOT NULL,
     payment_method TEXT NOT NULL,
     notification TEXT NOT NULL DEFAULT 'pending',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX orders_by_status ON orders (status, created_at);`,
  // Checkout details wait here until the shopper enters the code emailed to
  // them; codes_sent is the log behind the per-address hourly limit.
  `CREATE TABLE pending_checkouts (
     id TEXT PRIMARY KEY,
     customer TEXT NOT NULL,
     notes TEXT NOT NULL DEFAULT '',
     code TEXT NOT NULL,
     code_expires_at INTEGER NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     sent_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE codes_sent (
     address TEXT NOT NULL,
     sent_at INTEGER NOT NULL
   );
   CREATE INDEX codes_sent_by_address ON codes_sent (address, sent_at);`,
];

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  image_id: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  compare_at_price: number | null;
  category_id: string | null;
  image_ids: string;
  in_stock: number;
  featured: number;
  active: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

type OrderRow = {
  id: string;
  number: number;
  status: OrderStatus;
  customer: string;
  notes: string;
  items: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  currency: string;
  payment_method: 'cod';
  notification: string;
  created_at: number;
  updated_at: number;
}

type PendingCheckoutRow = {
  id: string;
  customer: string;
  notes: string;
  code: string;
  code_expires_at: number;
  attempts: number;
  sent_at: number;
  created_at: number;
}

function rowToCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    imageId: r.image_id,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToProduct(r: ProductRow): Product {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    price: r.price,
    compareAtPrice: r.compare_at_price,
    categoryId: r.category_id,
    imageIds: JSON.parse(r.image_ids) as string[],
    inStock: r.in_stock === 1,
    featured: r.featured === 1,
    active: r.active === 1,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToOrder(r: OrderRow): Order {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    customer: JSON.parse(r.customer) as OrderCustomer,
    notes: r.notes,
    items: JSON.parse(r.items) as OrderItem[],
    subtotal: r.subtotal,
    deliveryFee: r.delivery_fee,
    total: r.total,
    currency: r.currency,
    paymentMethod: r.payment_method,
    notification: r.notification,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Leaves the code out: it leaves the object only when issued, on its way into an email. */
function rowToPendingCheckout(r: PendingCheckoutRow): PendingCheckout {
  return {
    id: r.id,
    customer: JSON.parse(r.customer) as PendingCheckout['customer'],
    notes: r.notes,
    codeExpiresAt: r.code_expires_at,
    attemptsLeft: Math.max(OTP_MAX_ATTEMPTS - r.attempts, 0),
    resendAt: r.sent_at + OTP_RESEND_INTERVAL_MS,
  };
}

function cleanCustomer(customer: OrderCustomer): OrderCustomer {
  return {
    name: customer.name.trim(),
    phone: customer.phone.trim(),
    email: customer.email?.trim() || null,
    address: customer.address.trim(),
  };
}

function requireName(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Name is required');
  return trimmed;
}

function requireAmount(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative amount`);
  return value;
}

export class StoreDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);
    const current = sql.exec<{ v: number }>(`SELECT COALESCE(MAX(id), 0) AS v FROM _migrations`).one().v;
    for (let i = current; i < MIGRATIONS.length; i++) {
      sql.exec(MIGRATIONS[i]!);
      sql.exec(`INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`, i + 1, Date.now());
    }
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  // ───────────────────────── Settings ─────────────────────────

  getSettings(): Settings {
    const rows = this.sql.exec<{ value: string }>(`SELECT value FROM settings WHERE key = 'store'`).toArray();
    const stored = rows[0] ? (JSON.parse(rows[0].value) as Partial<Settings>) : {};
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const next: Settings = { ...this.getSettings(), ...patch };
    requireAmount(next.deliveryFee, 'Delivery fee');
    if (next.freeDeliveryOver !== null) requireAmount(next.freeDeliveryOver, 'Free delivery threshold');
    if (!next.storeName.trim()) throw new Error('Store name is required');
    this.sql.exec(
      `INSERT INTO settings (key, value) VALUES ('store', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(next),
    );
    return next;
  }

  /**
   * The Turnstile secret key lives in its own row, outside Settings: every
   * page gets the settings, while the secret only ever reaches the code that
   * verifies tokens. '' when none is saved.
   */
  getTurnstileSecret(): string {
    return this.sql.exec<{ value: string }>(`SELECT value FROM settings WHERE key = 'turnstile_secret'`).toArray()[0]?.value ?? '';
  }

  hasTurnstileSecret(): boolean {
    return this.getTurnstileSecret() !== '';
  }

  setTurnstileSecret(secret: string): void {
    this.sql.exec(
      `INSERT INTO settings (key, value) VALUES ('turnstile_secret', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      secret.trim(),
    );
  }

  // ───────────────────────── Categories ─────────────────────────

  listCategories(): Category[] {
    return this.sql
      .exec<CategoryRow>(`SELECT * FROM categories ORDER BY sort_order ASC, name ASC`)
      .toArray()
      .map(rowToCategory);
  }

  getCategory(id: string): Category | null {
    const row = this.sql.exec<CategoryRow>(`SELECT * FROM categories WHERE id = ?`, id).toArray()[0];
    return row ? rowToCategory(row) : null;
  }

  getCategoryBySlug(slug: string): Category | null {
    const row = this.sql.exec<CategoryRow>(`SELECT * FROM categories WHERE slug = ?`, slug).toArray()[0];
    return row ? rowToCategory(row) : null;
  }

  createCategory(input: CategoryInput): Category {
    const id = crypto.randomUUID();
    const now = Date.now();
    const name = requireName(input.name);
    const slug = this.uniqueSlug('categories', input.slug || name, id);
    this.sql.exec(
      `INSERT INTO categories (id, slug, name, description, image_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      slug,
      name,
      (input.description ?? '').trim(),
      input.imageId ?? null,
      input.sortOrder ?? 0,
      now,
      now,
    );
    return this.getCategory(id)!;
  }

  /** Returns null when the category does not exist. */
  updateCategory(id: string, input: Partial<CategoryInput>): Category | null {
    const existing = this.getCategory(id);
    if (!existing) return null;
    const name = input.name === undefined ? existing.name : requireName(input.name);
    const slug =
      input.slug === undefined ? existing.slug : this.uniqueSlug('categories', input.slug || name, id);
    this.sql.exec(
      `UPDATE categories SET slug = ?, name = ?, description = ?, image_id = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
      slug,
      name,
      (input.description ?? existing.description).trim(),
      input.imageId === undefined ? existing.imageId : input.imageId,
      input.sortOrder ?? existing.sortOrder,
      Date.now(),
      id,
    );
    return this.getCategory(id)!;
  }

  /** Deletes the category; its products become uncategorised. Returns the orphaned image id, if any. */
  deleteCategory(id: string): string | null {
    const existing = this.getCategory(id);
    if (!existing) return null;
    this.sql.exec(`UPDATE products SET category_id = NULL WHERE category_id = ?`, id);
    this.sql.exec(`DELETE FROM categories WHERE id = ?`, id);
    if (existing.imageId) this.deleteImage(existing.imageId);
    return existing.imageId;
  }

  // ───────────────────────── Products ─────────────────────────

  listProducts(filter: ProductFilter = {}): Product[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.categoryId !== undefined) {
      if (filter.categoryId === null) where.push('category_id IS NULL');
      else {
        where.push('category_id = ?');
        params.push(filter.categoryId);
      }
    }
    if (filter.activeOnly) where.push('active = 1');
    if (filter.featuredOnly) where.push('featured = 1');
    const query = filter.query?.trim().toLowerCase().slice(0, 100);
    if (query) {
      where.push('instr(lower(name), ?) > 0');
      params.push(query);
    }
    const limit = Math.min(Math.max(filter.limit ?? 1000, 1), 1000);
    const sqlText =
      `SELECT * FROM products` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY sort_order ASC, created_at DESC LIMIT ${limit}`;
    return this.sql.exec<ProductRow>(sqlText, ...params).toArray().map(rowToProduct);
  }

  getProduct(id: string): Product | null {
    const row = this.sql.exec<ProductRow>(`SELECT * FROM products WHERE id = ?`, id).toArray()[0];
    return row ? rowToProduct(row) : null;
  }

  getProducts(ids: string[]): Product[] {
    const unique = [...new Set(ids)].slice(0, 100);
    if (unique.length === 0) return [];
    const placeholders = unique.map(() => '?').join(',');
    return this.sql
      .exec<ProductRow>(`SELECT * FROM products WHERE id IN (${placeholders})`, ...unique)
      .toArray()
      .map(rowToProduct);
  }

  getProductBySlug(slug: string): Product | null {
    const row = this.sql.exec<ProductRow>(`SELECT * FROM products WHERE slug = ?`, slug).toArray()[0];
    return row ? rowToProduct(row) : null;
  }

  createProduct(input: ProductInput): Product {
    const id = crypto.randomUUID();
    const now = Date.now();
    const name = requireName(input.name);
    const slug = this.uniqueSlug('products', input.slug || name, id);
    this.sql.exec(
      `INSERT INTO products (id, slug, name, description, price, compare_at_price, category_id, image_ids,
                             in_stock, featured, active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      slug,
      name,
      (input.description ?? '').trim(),
      requireAmount(input.price, 'Price'),
      input.compareAtPrice == null ? null : requireAmount(input.compareAtPrice, 'Compare-at price'),
      this.existingCategoryId(input.categoryId ?? null),
      JSON.stringify(input.imageIds ?? []),
      input.inStock === false ? 0 : 1,
      input.featured ? 1 : 0,
      input.active === false ? 0 : 1,
      input.sortOrder ?? 0,
      now,
      now,
    );
    return this.getProduct(id)!;
  }

  /** Returns null when the product does not exist. */
  updateProduct(id: string, input: Partial<ProductInput>): Product | null {
    const existing = this.getProduct(id);
    if (!existing) return null;
    const name = input.name === undefined ? existing.name : requireName(input.name);
    const slug = input.slug === undefined ? existing.slug : this.uniqueSlug('products', input.slug || name, id);
    const price = input.price === undefined ? existing.price : requireAmount(input.price, 'Price');
    const compareAt =
      input.compareAtPrice === undefined
        ? existing.compareAtPrice
        : input.compareAtPrice === null
          ? null
          : requireAmount(input.compareAtPrice, 'Compare-at price');
    this.sql.exec(
      `UPDATE products SET slug = ?, name = ?, description = ?, price = ?, compare_at_price = ?, category_id = ?,
         image_ids = ?, in_stock = ?, featured = ?, active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
      slug,
      name,
      (input.description ?? existing.description).trim(),
      price,
      compareAt,
      input.categoryId === undefined ? existing.categoryId : this.existingCategoryId(input.categoryId),
      JSON.stringify(input.imageIds ?? existing.imageIds),
      (input.inStock ?? existing.inStock) ? 1 : 0,
      (input.featured ?? existing.featured) ? 1 : 0,
      (input.active ?? existing.active) ? 1 : 0,
      input.sortOrder ?? existing.sortOrder,
      Date.now(),
      id,
    );
    return this.getProduct(id)!;
  }

  /** Deletes the product and its images. */
  deleteProduct(id: string): boolean {
    const existing = this.getProduct(id);
    if (!existing) return false;
    this.sql.exec(`DELETE FROM products WHERE id = ?`, id);
    for (const imageId of existing.imageIds) this.deleteImage(imageId);
    return true;
  }

  // ───────────────────────── Images ─────────────────────────

  putImage(contentType: string, data: ArrayBuffer): string {
    if (!contentType.startsWith('image/')) throw new Error('Only image uploads are allowed');
    if (data.byteLength === 0) throw new Error('Image is empty');
    if (data.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`Image is too large (max ${Math.floor(MAX_IMAGE_BYTES / 1024)} KB)`);
    }
    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO images (id, content_type, size, data, created_at) VALUES (?, ?, ?, ?, ?)`,
      id,
      contentType,
      data.byteLength,
      data,
      Date.now(),
    );
    return id;
  }

  getImage(id: string): { contentType: string; data: ArrayBuffer } | null {
    const row = this.sql
      .exec<{ content_type: string; data: ArrayBuffer }>(`SELECT content_type, data FROM images WHERE id = ?`, id)
      .toArray()[0];
    return row ? { contentType: row.content_type, data: row.data } : null;
  }

  deleteImage(id: string): void {
    this.sql.exec(`DELETE FROM images WHERE id = ?`, id);
  }

  // ───────────────────────── Orders ─────────────────────────

  /**
   * Validates the cart against the live catalog, prices it server-side and
   * stores the order. Runs without awaiting, so the read-validate-write
   * sequence is atomic within the Durable Object.
   */
  placeOrder(input: PlaceOrderInput): PlaceOrderResult {
    const settings = this.getSettings();
    if (!settings.storeOpen) {
      return { ok: false, code: 'closed', message: settings.closedMessage };
    }

    const wanted = new Map<string, number>();
    for (const line of input.items) {
      const qty = Math.floor(Number(line.qty));
      if (!Number.isFinite(qty) || qty < 1) continue;
      wanted.set(line.productId, Math.min((wanted.get(line.productId) ?? 0) + qty, MAX_ORDER_QTY));
      if (wanted.size > MAX_ORDER_LINES) break;
    }
    if (wanted.size === 0) return { ok: false, code: 'empty', message: 'Your cart is empty.' };

    const products = new Map(this.getProducts([...wanted.keys()]).map((p) => [p.id, p]));
    const items: OrderItem[] = [];
    for (const [productId, qty] of wanted) {
      const product = products.get(productId);
      if (!product || !product.active) {
        return { ok: false, code: 'unavailable', message: 'One of the items in your cart is no longer available.' };
      }
      if (!product.inStock) {
        return { ok: false, code: 'unavailable', message: `"${product.name}" is out of stock.` };
      }
      items.push({ productId, name: product.name, price: product.price, qty, imageId: product.imageIds[0] ?? null });
    }

    const { subtotal, deliveryFee, total } = computeTotals(items, settings);

    const id = crypto.randomUUID();
    const now = Date.now();
    const number =
      this.sql.exec<{ n: number }>(`SELECT COALESCE(MAX(number), ?) + 1 AS n FROM orders`, FIRST_ORDER_NUMBER - 1).one().n;
    const customer = cleanCustomer(input.customer);
    this.sql.exec(
      `INSERT INTO orders (id, number, status, customer, notes, items, subtotal, delivery_fee, total, currency,
                           payment_method, notification, created_at, updated_at)
       VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, 'cod', 'pending', ?, ?)`,
      id,
      number,
      JSON.stringify(customer),
      (input.notes ?? '').trim(),
      JSON.stringify(items),
      subtotal,
      deliveryFee,
      total,
      settings.currency,
      now,
      now,
    );
    return { ok: true, order: this.getOrder(id)! };
  }

  listOrders(opts: { status?: OrderStatus; limit?: number; offset?: number } = {}): Order[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = opts.status
      ? this.sql.exec<OrderRow>(
          `SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          opts.status,
          limit,
          offset,
        )
      : this.sql.exec<OrderRow>(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset);
    return rows.toArray().map(rowToOrder);
  }

  getOrder(id: string): Order | null {
    const row = this.sql.exec<OrderRow>(`SELECT * FROM orders WHERE id = ?`, id).toArray()[0];
    return row ? rowToOrder(row) : null;
  }

  /** Returns null when the order does not exist or the status is not a known one. */
  updateOrderStatus(id: string, status: OrderStatus): Order | null {
    if (!ORDER_STATUSES.includes(status)) return null;
    const updated = this.sql
      .exec<{ id: string }>(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? RETURNING id`, status, Date.now(), id)
      .toArray();
    return updated.length === 0 ? null : this.getOrder(id);
  }

  setOrderNotification(id: string, notification: string): void {
    this.sql.exec(`UPDATE orders SET notification = ? WHERE id = ?`, notification.slice(0, 200), id);
  }

  // ───────────────────────── Checkout verification ─────────────────────────

  /**
   * Holds a shopper's checkout details until they prove they own the email
   * address, and issues the first code for the route to send. `replaceId`
   * is the shopper's earlier pending checkout, if any (they went back to
   * change something); it is dropped so only the latest details can become
   * an order.
   */
  startCheckout(input: CheckoutInput, replaceId: string | null = null): IssueCodeResult {
    const now = Date.now();
    this.purgeCheckouts(now);
    const customer = cleanCustomer(input.customer);
    if (!customer.email) throw new Error('An email address is required to confirm a checkout');
    const limited = this.sendLimitReached(customer.email, now);
    if (limited) return limited;

    if (replaceId) this.sql.exec(`DELETE FROM pending_checkouts WHERE id = ?`, replaceId);
    const id = crypto.randomUUID();
    const otp = generateOtp();
    this.sql.exec(
      `INSERT INTO pending_checkouts (id, customer, notes, code, code_expires_at, attempts, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      id,
      JSON.stringify(customer),
      (input.notes ?? '').trim(),
      otp,
      now + OTP_TTL_MS,
      now,
      now,
    );
    this.recordSend(customer.email, now);
    return { ok: true, pending: this.getPendingCheckout(id)!, otp };
  }

  /** Issues a fresh code for a pending checkout. The previous code stops working. */
  resendCheckoutCode(id: string): IssueCodeResult {
    const now = Date.now();
    this.purgeCheckouts(now);
    const row = this.pendingCheckoutRow(id, now);
    if (!row) return CHECKOUT_MISSING;
    const wait = row.sent_at + OTP_RESEND_INTERVAL_MS - now;
    if (wait > 0) {
      return { ok: false, code: 'too_soon', message: `Please wait ${Math.ceil(wait / 1000)} seconds before asking for another code.` };
    }
    const { email } = rowToPendingCheckout(row).customer;
    const limited = this.sendLimitReached(email, now);
    if (limited) return limited;

    const otp = generateOtp();
    this.sql.exec(
      `UPDATE pending_checkouts SET code = ?, code_expires_at = ?, attempts = 0, sent_at = ? WHERE id = ?`,
      otp,
      now + OTP_TTL_MS,
      now,
      id,
    );
    this.recordSend(email, now);
    return { ok: true, pending: this.getPendingCheckout(id)!, otp };
  }

  getPendingCheckout(id: string): PendingCheckout | null {
    const row = this.pendingCheckoutRow(id, Date.now());
    return row ? rowToPendingCheckout(row) : null;
  }

  /**
   * Turns a pending checkout into an order once the shopper enters the code
   * we emailed them. Checking the code and placing the order run without
   * awaiting, so together they are atomic and a code works only once. A
   * wrong code counts against the attempt limit. A right code that cannot
   * become an order (store closed, item sold out) is not used up, so the
   * shopper can sort out their cart and confirm again.
   */
  confirmCheckout(id: string, otp: string, items: PlaceOrderInput['items']): ConfirmCheckoutResult {
    const now = Date.now();
    const row = this.pendingCheckoutRow(id, now);
    if (!row) return CHECKOUT_MISSING;
    const locked = { ok: false, code: 'locked', message: 'Too many wrong codes. Please ask for a new code.' } as const;
    if (row.attempts >= OTP_MAX_ATTEMPTS) return locked;
    if (now >= row.code_expires_at) return { ok: false, code: 'expired', message: 'That code has expired. Please ask for a new one.' };
    if (otp !== row.code) {
      this.sql.exec(`UPDATE pending_checkouts SET attempts = attempts + 1 WHERE id = ?`, id);
      const left = OTP_MAX_ATTEMPTS - row.attempts - 1;
      if (left === 0) return locked;
      return { ok: false, code: 'wrong_code', message: `That code is not right. You have ${left} ${left === 1 ? 'try' : 'tries'} left.` };
    }

    const result = this.placeOrder({ customer: JSON.parse(row.customer) as OrderCustomer, notes: row.notes, items });
    if (result.ok) this.sql.exec(`DELETE FROM pending_checkouts WHERE id = ?`, id);
    return result;
  }

  // ───────────────────────── Stats ─────────────────────────

  getStats(): StoreStats {
    const products = this.sql
      .exec<{ total: number; active: number }>(`SELECT COUNT(*) AS total, COALESCE(SUM(active), 0) AS active FROM products`)
      .one();
    const categories = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM categories`).one().n;
    const orders = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
    for (const row of this.sql.exec<{ status: OrderStatus; n: number }>(`SELECT status, COUNT(*) AS n FROM orders GROUP BY status`)) {
      if (row.status in orders) orders[row.status] = row.n;
    }
    return { products: products.total, activeProducts: products.active, categories, orders };
  }

  // ───────────────────────── Helpers ─────────────────────────

  /**
   * A pending checkout lasts PENDING_CHECKOUT_TTL_MS from its latest code, so no code outlives
   * its checkout. Stale ones count as gone even before they are purged.
   */
  private pendingCheckoutRow(id: string, now: number): PendingCheckoutRow | null {
    const row = this.sql.exec<PendingCheckoutRow>(`SELECT * FROM pending_checkouts WHERE id = ?`, id).toArray()[0];
    return row && row.sent_at > now - PENDING_CHECKOUT_TTL_MS ? row : null;
  }

  /** Every code issued counts, delivered or not, so failures cannot be used to get around the limit. */
  private sendLimitReached(email: string, now: number): IssueCodeResult | null {
    const sent = this.sql
      .exec<{ n: number; oldest: number | null }>(
        `SELECT COUNT(*) AS n, MIN(sent_at) AS oldest FROM codes_sent WHERE address = ? AND sent_at > ?`,
        email.toLowerCase(),
        now - HOUR_MS,
      )
      .one();
    if (sent.n < OTP_MAX_PER_ADDRESS_PER_HOUR) return null;
    const minutes = Math.max(Math.ceil(((sent.oldest ?? now) + HOUR_MS - now) / 60_000), 1);
    return {
      ok: false,
      code: 'rate_limited',
      message: `We have already sent several codes to ${email}. Please try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
    };
  }

  private recordSend(email: string, now: number): void {
    this.sql.exec(`INSERT INTO codes_sent (address, sent_at) VALUES (?, ?)`, email.toLowerCase(), now);
  }

  /** Housekeeping on every code issued keeps both tables down to the last hour's activity. */
  private purgeCheckouts(now: number): void {
    this.sql.exec(`DELETE FROM pending_checkouts WHERE sent_at <= ?`, now - PENDING_CHECKOUT_TTL_MS);
    this.sql.exec(`DELETE FROM codes_sent WHERE sent_at <= ?`, now - HOUR_MS);
  }

  private existingCategoryId(categoryId: string | null): string | null {
    if (!categoryId) return null;
    return this.getCategory(categoryId) ? categoryId : null;
  }

  /** Makes `base` a slug that no other row in `table` uses, appending -2, -3… as needed. */
  private uniqueSlug(table: 'categories' | 'products', base: string, ownId: string): string {
    const root = slugify(base);
    let candidate = root;
    for (let n = 2; n < 1000; n++) {
      const clash = this.sql
        .exec<{ id: string }>(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`, candidate, ownId)
        .toArray();
      if (clash.length === 0) return candidate;
      candidate = `${root}-${n}`;
    }
    return `${root}-${crypto.randomUUID().slice(0, 8)}`;
  }
}
