import type { FC } from 'hono/jsx';
import { OTP_DIGITS, OTP_TTL_MINUTES } from '../../otp';
import type { Totals } from '../../pricing';
import { TURNSTILE_SCRIPT } from '../../turnstile';
import type { Category, Order, OrderCustomer, PendingCheckout, Product, Settings } from '../../types';
import { ORDER_STATUS_LABELS } from '../../types';
import { formatDate, Paragraphs } from '../text';
import { Notice, Price, ProductGrid, ProductImage, ProductPrice } from './components';
import { StorePage, type Shell } from './layout';

const ClosedNotice: FC<{ settings: Settings }> = ({ settings }) =>
  settings.storeOpen ? null : <Notice kind="info">{settings.closedMessage}</Notice>;

// ───────────────────────── Home ─────────────────────────

export const HomePage: FC<{ shell: Shell; products: Product[] }> = ({ shell, products }) => {
  const { settings, categories } = shell;
  const featured = products.filter((p) => p.featured);
  const showcase = featured.length > 0 ? featured : products.slice(0, 8);
  const countByCategory = new Map<string | null, number>();
  for (const p of products) countByCategory.set(p.categoryId, (countByCategory.get(p.categoryId) ?? 0) + 1);

  return (
    <StorePage shell={shell}>
      <ClosedNotice settings={settings} />
      <section class="hero">
        <h1>{settings.storeName}</h1>
        {settings.tagline ? <p class="lead">{settings.tagline}</p> : null}
        {settings.description ? <Paragraphs text={settings.description} class="muted" /> : null}
        {products.length > 0 ? (
          <a href="/products" class="btn btn-primary">
            Shop all products
          </a>
        ) : null}
      </section>

      {categories.length > 0 ? (
        <section>
          <h2>Categories</h2>
          <div class="grid grid-categories">
            {categories.map((cat) => (
              <a href={`/c/${cat.slug}`} class="card">
                <div class="card-media">
                  <ProductImage imageId={cat.imageId} alt={cat.name} />
                </div>
                <div class="card-body">
                  <h3>{cat.name}</h3>
                  <span class="muted">
                    {countByCategory.get(cat.id) ?? 0} {countByCategory.get(cat.id) === 1 ? 'product' : 'products'}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2>{featured.length > 0 ? 'Featured' : 'Products'}</h2>
        <ProductGrid products={showcase} settings={settings} emptyText="The shelves are being stocked. Check back soon!" />
      </section>
    </StorePage>
  );
};

// ───────────────────────── Listings ─────────────────────────

export const ProductsPage: FC<{ shell: Shell; products: Product[]; query: string }> = ({ shell, products, query }) => (
  <StorePage shell={shell} title={query ? `Search: ${query}` : 'All products'}>
    <ClosedNotice settings={shell.settings} />
    <h1>{query ? `Results for “${query}”` : 'All products'}</h1>
    <ProductGrid products={products} settings={shell.settings} emptyText={query ? 'Nothing matched your search.' : undefined} />
  </StorePage>
);

export const CategoryPage: FC<{ shell: Shell; category: Category; products: Product[] }> = ({ shell, category, products }) => (
  <StorePage shell={shell} title={category.name} description={category.description || undefined}>
    <ClosedNotice settings={shell.settings} />
    <h1>{category.name}</h1>
    {category.description ? <Paragraphs text={category.description} class="lead" /> : null}
    <ProductGrid products={products} settings={shell.settings} />
  </StorePage>
);

// ───────────────────────── Product ─────────────────────────

export const ProductPage: FC<{ shell: Shell; product: Product; category: Category | null; related: Product[]; added: boolean; origin: string }> = ({
  shell,
  product,
  category,
  related,
  added,
  origin,
}) => {
  const { settings } = shell;
  const [primary, ...rest] = product.imageIds;
  const canOrder = settings.storeOpen && product.inStock;
  const path = `/p/${product.slug}`;
  const head = (
    <>
      <meta property="og:title" content={product.name} />
      <meta property="og:type" content="product" />
      <meta property="og:url" content={`${origin}${path}`} />
      {primary ? <meta property="og:image" content={`${origin}/img/${primary}`} /> : null}
      {product.description ? <meta property="og:description" content={product.description.slice(0, 200)} /> : null}
    </>
  );
  return (
    <StorePage shell={shell} title={product.name} description={product.description.slice(0, 160) || undefined} head={head}>
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <a href="/">Home</a>
        {category ? (
          <>
            <span>/</span>
            <a href={`/c/${category.slug}`}>{category.name}</a>
          </>
        ) : null}
        <span>/</span>
        <span>{product.name}</span>
      </nav>
      {added ? (
        <Notice kind="success">
          Added to your cart. <a href="/cart">View cart</a> or keep shopping.
        </Notice>
      ) : null}
      <ClosedNotice settings={settings} />
      <article class="product">
        <div class="gallery">
          <ProductImage imageId={primary} alt={product.name} class="gallery-main" />
          {rest.length > 0 ? (
            <div class="thumbs">
              {product.imageIds.map((id, i) => (
                <a href={`/img/${id}`} class={`thumb${i === 0 ? ' active' : ''}`} data-image={`/img/${id}`}>
                  <img src={`/img/${id}`} alt={`${product.name} photo ${i + 1}`} loading="lazy" />
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <div class="product-info">
          <h1>{product.name}</h1>
          <p class="product-price">
            <ProductPrice product={product} settings={settings} />
          </p>
          {!product.inStock ? <p class="stock-out">Currently out of stock</p> : null}
          {canOrder ? (
            <form method="post" action="/cart/add" class="add-to-cart">
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="return" value={path} />
              <label>
                Qty
                <input type="number" name="qty" value="1" min="1" max="99" required />
              </label>
              <button type="submit" class="btn btn-primary">
                Add to cart
              </button>
            </form>
          ) : null}
          {product.description ? (
            <div class="description">
              <Paragraphs text={product.description} />
            </div>
          ) : null}
          <p class="muted small">Cash on delivery — pay when it arrives.</p>
        </div>
      </article>
      {related.length > 0 ? (
        <section>
          <h2>You may also like</h2>
          <ProductGrid products={related} settings={settings} />
        </section>
      ) : null}
    </StorePage>
  );
};

// ───────────────────────── Cart ─────────────────────────

export interface CartLineView {
  product: Product;
  qty: number;
}

const TotalsTable: FC<{ totals: Totals; settings: Settings }> = ({ totals, settings }) => (
  <dl class="totals">
    <dt>Subtotal</dt>
    <dd>
      <Price amount={totals.subtotal} settings={settings} />
    </dd>
    <dt>Delivery</dt>
    <dd>{totals.deliveryFee === 0 ? 'Free' : <Price amount={totals.deliveryFee} settings={settings} />}</dd>
    <dt class="grand">Total</dt>
    <dd class="grand">
      <Price amount={totals.total} settings={settings} />
    </dd>
  </dl>
);

export const CartPage: FC<{ shell: Shell; lines: CartLineView[]; totals: Totals; problems: string[] }> = ({ shell, lines, totals, problems }) => {
  const { settings } = shell;
  return (
    <StorePage shell={shell} title="Your cart" mainClass="narrow">
      <h1>Your cart</h1>
      <ClosedNotice settings={settings} />
      {problems.map((p) => (
        <Notice kind="error">{p}</Notice>
      ))}
      {lines.length === 0 ? (
        <p class="empty">
          Your cart is empty. <a href="/products">Browse products</a>.
        </p>
      ) : (
        <>
          <ul class="cart-lines">
            {lines.map(({ product, qty }) => (
              <li class="cart-line">
                <a href={`/p/${product.slug}`} class="cart-thumb">
                  <ProductImage imageId={product.imageIds[0]} alt={product.name} />
                </a>
                <div class="cart-line-body">
                  <a href={`/p/${product.slug}`} class="cart-name">
                    {product.name}
                  </a>
                  <div class="muted">
                    <Price amount={product.price} settings={settings} /> each
                  </div>
                  <div class="cart-actions">
                    <form method="post" action="/cart/update" class="inline">
                      <input type="hidden" name="productId" value={product.id} />
                      <input type="number" name="qty" value={String(qty)} min="0" max="99" aria-label={`Quantity of ${product.name}`} />
                      <button type="submit" class="btn btn-small">
                        Update
                      </button>
                    </form>
                    <form method="post" action="/cart/remove" class="inline">
                      <input type="hidden" name="productId" value={product.id} />
                      <button type="submit" class="btn btn-small btn-link">
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
                <div class="cart-line-total">
                  <Price amount={product.price * qty} settings={settings} />
                </div>
              </li>
            ))}
          </ul>
          <TotalsTable totals={totals} settings={settings} />
          {settings.freeDeliveryOver !== null && totals.deliveryFee > 0 ? (
            <p class="muted small">
              Free delivery on orders over <Price amount={settings.freeDeliveryOver} settings={settings} />.
            </p>
          ) : null}
          <div class="actions">
            <a href="/products" class="btn">
              Continue shopping
            </a>
            {settings.storeOpen ? (
              <a href="/checkout" class="btn btn-primary">
                Checkout
              </a>
            ) : null}
          </div>
        </>
      )}
    </StorePage>
  );
};

// ───────────────────────── Checkout ─────────────────────────

export interface CheckoutValues extends OrderCustomer {
  notes: string;
}

export type CheckoutErrors = Partial<Record<keyof CheckoutValues | 'form', string>>;

export const emptyCheckoutValues: CheckoutValues = { name: '', phone: '', email: null, address: '', notes: '' };

const OrderSummary: FC<{ lines: CartLineView[]; totals: Totals; settings: Settings; children?: unknown }> = ({ lines, totals, settings, children }) => (
  <aside class="order-summary">
    <h2>Your order</h2>
    <ul class="summary-lines">
      {lines.map(({ product, qty }) => (
        <li>
          <span>
            {product.name} <span class="muted">× {qty}</span>
          </span>
          <Price amount={product.price * qty} settings={settings} />
        </li>
      ))}
    </ul>
    <TotalsTable totals={totals} settings={settings} />
    <a href="/cart" class="small">
      Edit cart
    </a>
    {children}
  </aside>
);

const Field: FC<{ name: string; label: string; error?: string; children?: unknown; hint?: string }> = ({ name, label, error, hint, children }) => (
  <div class={`field${error ? ' has-error' : ''}`}>
    <label for={`f-${name}`}>{label}</label>
    {children}
    {hint ? <small class="muted">{hint}</small> : null}
    {error ? <small class="error">{error}</small> : null}
  </div>
);

/**
 * Delivery details. With email confirmation on, submitting emails a code
 * and the order is placed on the next page; otherwise it places the order.
 */
export const CheckoutPage: FC<{
  shell: Shell;
  lines: CartLineView[];
  totals: Totals;
  values: CheckoutValues;
  errors: CheckoutErrors;
  /** False when email confirmation is on but the store cannot send codes. */
  canTakeOrders: boolean;
}> = ({ shell, lines, totals, values, errors, canTakeOrders }) => {
  const { settings } = shell;
  const { confirmEmail } = settings;
  const turnstileSiteKey = settings.turnstileEnabled ? settings.turnstileSiteKey : '';
  const contact = [settings.contactPhone, settings.contactEmail].filter(Boolean).join(' · ');
  return (
    <StorePage
      shell={shell}
      title="Checkout"
      mainClass="narrow"
      head={turnstileSiteKey ? <script src={TURNSTILE_SCRIPT} async defer></script> : undefined}
    >
      <h1>Checkout</h1>
      {!canTakeOrders ? (
        <Notice kind="error">
          Online ordering is unavailable right now: this store cannot send email confirmation codes yet.
          {contact ? ` Please contact us to order: ${contact}.` : ' Please try again later.'}
        </Notice>
      ) : null}
      {errors.form ? <Notice kind="error">{errors.form}</Notice> : null}
      {settings.checkoutNote ? <Notice kind="info">{settings.checkoutNote}</Notice> : null}
      <div class="checkout">
        <form method="post" action="/checkout" class="checkout-form" novalidate>
          <h2>Delivery details</h2>
          <Field name="name" label="Full name" error={errors.name}>
            <input id="f-name" name="name" type="text" value={values.name} required maxlength={100} autocomplete="name" />
          </Field>
          <Field name="phone" label="Phone number" error={errors.phone} hint="We will call or message this number to confirm your order.">
            <input id="f-phone" name="phone" type="tel" value={values.phone} required maxlength={20} autocomplete="tel" />
          </Field>
          <Field
            name="email"
            label={confirmEmail ? 'Email' : 'Email (optional)'}
            error={errors.email}
            hint={confirmEmail ? 'We will email you a code to confirm your order, then your order details.' : 'For a copy of your order confirmation.'}
          >
            <input id="f-email" name="email" type="email" value={values.email ?? ''} required={confirmEmail} maxlength={254} autocomplete="email" />
          </Field>
          <Field name="address" label="Delivery address" error={errors.address}>
            <textarea id="f-address" name="address" rows={4} required maxlength={500} autocomplete="street-address">
              {values.address}
            </textarea>
          </Field>
          <Field name="notes" label="Notes for us (optional)" error={errors.notes}>
            <textarea id="f-notes" name="notes" rows={2} maxlength={500}>
              {values.notes}
            </textarea>
          </Field>
          {turnstileSiteKey ? (
            <>
              {/* The widget adds its token to this form as cf-turnstile-response. */}
              <div class="cf-turnstile" data-sitekey={turnstileSiteKey} data-action="turnstile-spin-v2" data-theme="light" data-size="flexible"></div>
              <noscript>
                <Notice kind="error">Please turn on JavaScript: it is needed for the security check before you can order.</Notice>
              </noscript>
            </>
          ) : null}
          <p class="muted small">Payment: cash on delivery. You pay when the order arrives.</p>
          <button type="submit" class="btn btn-primary btn-block" disabled={!canTakeOrders}>
            {confirmEmail ? (
              'Continue'
            ) : (
              <>
                Place order · <Price amount={totals.total} settings={settings} />
              </>
            )}
          </button>
        </form>
        <OrderSummary lines={lines} totals={totals} settings={settings} />
      </div>
    </StorePage>
  );
};

/** Checkout step 2: the shopper enters the code we emailed, and the order is placed. */
export const VerifyEmailPage: FC<{
  shell: Shell;
  lines: CartLineView[];
  totals: Totals;
  pending: PendingCheckout;
  notice?: string;
  error?: string;
}> = ({ shell, lines, totals, pending, notice, error }) => {
  const { settings } = shell;
  const { customer } = pending;
  return (
    <StorePage shell={shell} title="Confirm your email" mainClass="narrow">
      <h1>Confirm your email</h1>
      {notice ? <Notice kind="success">{notice}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
      <div class="checkout">
        <div>
          <form method="post" action="/checkout/verify" class="checkout-form" novalidate>
            <p>
              We sent a {OTP_DIGITS}-digit code to <strong>{customer.email}</strong>. Enter it to place your order.
            </p>
            <Field
              name="code"
              label="Confirmation code"
              hint={`The code works for ${OTP_TTL_MINUTES} minutes. Can't find the email? Check your spam folder.`}
            >
              <input id="f-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" required maxlength={12} class="otp" autofocus />
            </Field>
            <button type="submit" class="btn btn-primary btn-block">
              Place order · <Price amount={totals.total} settings={settings} />
            </button>
          </form>
          <form method="post" action="/checkout/resend" class="resend">
            Didn't get it?{' '}
            <button type="submit" class="link-button">
              Send a new code
            </button>
          </form>
          <p class="small">
            <a href="/checkout">Change your email or delivery details</a>
          </p>
        </div>
        <OrderSummary lines={lines} totals={totals} settings={settings}>
          <section class="summary-section">
            <h3>Delivering to</h3>
            <p>
              <strong>{customer.name}</strong>
              <br />
              {customer.phone}
            </p>
            <p class="pre-line">{customer.address}</p>
          </section>
        </OrderSummary>
      </div>
    </StorePage>
  );
};

// ───────────────────────── Order confirmation ─────────────────────────

export const OrderPage: FC<{ shell: Shell; order: Order; justPlaced: boolean }> = ({ shell, order, justPlaced }) => {
  const { settings } = shell;
  const money = { currency: order.currency, locale: settings.locale } as Settings;
  return (
    <StorePage shell={shell} title={`Order #${order.number}`} mainClass="narrow">
      {justPlaced ? (
        <Notice kind="success">
          <strong>Order placed!</strong> {settings.thankYouMessage}
        </Notice>
      ) : null}
      <h1>Order #{order.number}</h1>
      <p class="muted">
        Placed {formatDate(order.createdAt, settings.locale)} · Status: <span class={`status status-${order.status}`}>{ORDER_STATUS_LABELS[order.status]}</span>
      </p>
      <section class="panel">
        <h2>Items</h2>
        <ul class="summary-lines">
          {order.items.map((item) => (
            <li>
              <span>
                {item.name} <span class="muted">× {item.qty}</span>
              </span>
              <Price amount={item.price * item.qty} settings={money} />
            </li>
          ))}
        </ul>
        <TotalsTable totals={{ subtotal: order.subtotal, deliveryFee: order.deliveryFee, total: order.total }} settings={money} />
        <p class="muted small">Payment: cash on delivery.</p>
      </section>
      <section class="panel">
        <h2>Delivering to</h2>
        <p>
          <strong>{order.customer.name}</strong>
          <br />
          {order.customer.phone}
          {order.customer.email ? (
            <>
              <br />
              {order.customer.email}
            </>
          ) : null}
        </p>
        <p class="pre-line">{order.customer.address}</p>
        {order.notes ? (
          <p class="muted">
            <em>Notes:</em> {order.notes}
          </p>
        ) : null}
      </section>
      <p>
        Questions? {settings.contactPhone ? <>Call us at {settings.contactPhone}. </> : null}
        <a href="/">Back to the store</a>.
      </p>
    </StorePage>
  );
};
