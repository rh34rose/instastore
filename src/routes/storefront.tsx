import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../app';
import { CART_COOKIE, CART_MAX_AGE_SECONDS, cartCount, parseCart, serializeCart, setCartLine, type CartLines } from '../cart';
import { canSendCodes, canTakeOrders, sendOrderEmails, sendVerificationCode, type CodeSendOutcome } from '../email';
import { integer, isEmail, isPhone, safeReturnPath, text } from '../forms';
import { OTP_DIGITS, OTP_TTL_MINUTES, PENDING_CHECKOUT_TTL_MS, parseOtp } from '../otp';
import { computeTotals } from '../pricing';
import { TURNSTILE_FIELD, verifyTurnstile, type TurnstileResult } from '../turnstile';
import type { Order, Product, Settings } from '../types';
import { NotFoundPage } from '../views/errors';
import type { Shell } from '../views/store/layout';
import {
  CartPage,
  CategoryPage,
  CheckoutPage,
  HomePage,
  OrderPage,
  ProductPage,
  ProductsPage,
  VerifyEmailPage,
  emptyCheckoutValues,
  type CartLineView,
  type CheckoutErrors,
  type CheckoutValues,
} from '../views/store/pages';

const store = new Hono<AppEnv>();

type Ctx = Context<AppEnv>;

function cookieOptions(c: Ctx, path: string, maxAge: number) {
  return { path, httpOnly: true, sameSite: 'Lax', secure: new URL(c.req.url).protocol === 'https:', maxAge } as const;
}

function readCart(c: Ctx): CartLines {
  return parseCart(getCookie(c, CART_COOKIE));
}

function writeCart(c: Ctx, lines: CartLines): void {
  if (lines.size === 0) {
    deleteCookie(c, CART_COOKIE, { path: '/' });
    return;
  }
  setCookie(c, CART_COOKIE, serializeCart(lines), cookieOptions(c, '/', CART_MAX_AGE_SECONDS));
}

/** Points at the shopper's pending checkout while they are between the form and the code. */
const CHECKOUT_COOKIE = 'checkout';
const PENDING_ID_RE = /^[0-9a-f-]{36}$/;

function readPendingId(c: Ctx): string | null {
  const id = getCookie(c, CHECKOUT_COOKIE);
  return id && PENDING_ID_RE.test(id) ? id : null;
}

function writePendingId(c: Ctx, id: string | null): void {
  if (!id) {
    deleteCookie(c, CHECKOUT_COOKIE, { path: '/checkout' });
    return;
  }
  setCookie(c, CHECKOUT_COOKIE, id, cookieOptions(c, '/checkout', PENDING_CHECKOUT_TTL_MS / 1000));
}

/** Loads settings + categories (one pipelined round-trip) and the cart badge count. */
async function loadShell(c: Ctx, cart: CartLines = readCart(c)): Promise<Shell> {
  const [settings, categories] = await Promise.all([c.get('store').getSettings(), c.get('store').listCategories()]);
  return { settings, categories, cartCount: cartCount(cart), path: new URL(c.req.url).pathname };
}

/**
 * Resolves cart lines against the live catalog. Lines whose product vanished,
 * was hidden or sold out are dropped and reported so the shopper knows why.
 */
function resolveCart(cart: CartLines, products: Product[], open: boolean): { lines: CartLineView[]; problems: string[] } {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: CartLineView[] = [];
  const problems: string[] = [];
  for (const [productId, qty] of cart) {
    const product = byId.get(productId);
    if (!product || !product.active) {
      problems.push('An item that is no longer available was removed from your cart.');
      cart.delete(productId);
    } else if (!product.inStock) {
      problems.push(`"${product.name}" is out of stock and was removed from your cart.`);
      cart.delete(productId);
    } else {
      lines.push({ product, qty });
    }
  }
  if (!open && lines.length > 0) problems.length = 0;
  return { lines, problems };
}

// ───────────────────────── Browsing ─────────────────────────

store.get('/', async (c) => {
  const cart = readCart(c);
  const [shell, products] = await Promise.all([loadShell(c, cart), c.get('store').listProducts({ activeOnly: true })]);
  return c.html(<HomePage shell={shell} products={products} />);
});

store.get('/products', async (c) => {
  const query = (c.req.query('q') ?? '').trim().slice(0, 100);
  const [shell, products] = await Promise.all([loadShell(c), c.get('store').listProducts({ activeOnly: true, query })]);
  return c.html(<ProductsPage shell={shell} products={products} query={query} />);
});

store.get('/c/:slug', async (c) => {
  const shell = await loadShell(c);
  const category = shell.categories.find((cat) => cat.slug === c.req.param('slug'));
  if (!category) return c.html(<NotFoundPage />, 404);
  const products = await c.get('store').listProducts({ categoryId: category.id, activeOnly: true });
  return c.html(<CategoryPage shell={shell} category={category} products={products} />);
});

store.get('/p/:slug', async (c) => {
  const [shell, product] = await Promise.all([loadShell(c), c.get('store').getProductBySlug(c.req.param('slug'))]);
  if (!product || !product.active) return c.html(<NotFoundPage />, 404);
  const category = shell.categories.find((cat) => cat.id === product.categoryId) ?? null;
  const related = (await c.get('store').listProducts({ categoryId: product.categoryId, activeOnly: true, limit: 9 }))
    .filter((p) => p.id !== product.id)
    .slice(0, 4);
  return c.html(
    <ProductPage
      shell={shell}
      product={product}
      category={category}
      related={related}
      added={c.req.query('added') === '1'}
      origin={new URL(c.req.url).origin}
    />,
  );
});

// ───────────────────────── Cart ─────────────────────────

store.get('/cart', async (c) => {
  const cart = readCart(c);
  const [shell, products] = await Promise.all([loadShell(c, cart), c.get('store').getProducts([...cart.keys()])]);
  const { lines, problems } = resolveCart(cart, products, shell.settings.storeOpen);
  writeCart(c, cart);
  shell.cartCount = cartCount(cart);
  const totals = computeTotals(lines.map((l) => ({ price: l.product.price, qty: l.qty })), shell.settings);
  return c.html(<CartPage shell={shell} lines={lines} totals={totals} problems={problems} />);
});

store.post('/cart/add', async (c) => {
  const form = await c.req.formData();
  const productId = text(form, 'productId', 40);
  const qty = Math.max(integer(form, 'qty', 1), 1);
  const product = await c.get('store').getProduct(productId);
  if (!product || !product.active || !product.inStock) return c.redirect('/cart');
  const cart = readCart(c);
  setCartLine(cart, productId, (cart.get(productId) ?? 0) + qty);
  writeCart(c, cart);
  const back = safeReturnPath(text(form, 'return', 200), '/cart');
  return c.redirect(back === '/cart' ? back : `${back}?added=1`);
});

store.post('/cart/update', async (c) => {
  const form = await c.req.formData();
  const cart = readCart(c);
  setCartLine(cart, text(form, 'productId', 40), integer(form, 'qty', 1));
  writeCart(c, cart);
  return c.redirect('/cart');
});

store.post('/cart/remove', async (c) => {
  const form = await c.req.formData();
  const cart = readCart(c);
  setCartLine(cart, text(form, 'productId', 40), 0);
  writeCart(c, cart);
  return c.redirect('/cart');
});

// ───────────────────────── Checkout ─────────────────────────
//
// With email confirmation off (the default), the checkout form places the
// order. With it on, ordering takes two steps: the form keeps the
// shopper's details as a pending checkout and emails them a one-time
// code, and the order is placed only when that code comes back on
// /checkout/verify. Either way the cart cookie is cleared only once the
// order exists, so a wrong or expired code leaves the cart as it was.

async function loadCheckout(c: Ctx) {
  const cart = readCart(c);
  const [shell, products] = await Promise.all([loadShell(c, cart), c.get('store').getProducts([...cart.keys()])]);
  const { lines } = resolveCart(cart, products, shell.settings.storeOpen);
  const totals = computeTotals(lines.map((l) => ({ price: l.product.price, qty: l.qty })), shell.settings);
  return { shell, cart, lines, totals };
}

store.get('/checkout', async (c) => {
  const pendingId = readPendingId(c);
  const [{ shell, lines, totals }, pending] = await Promise.all([
    loadCheckout(c),
    pendingId ? c.get('store').getPendingCheckout(pendingId) : null,
  ]);
  if (lines.length === 0 || !shell.settings.storeOpen) return c.redirect('/cart');
  // Back from the code step to change something: start from what they entered.
  const values = pending ? { ...pending.customer, notes: pending.notes } : emptyCheckoutValues;
  return c.html(
    <CheckoutPage shell={shell} lines={lines} totals={totals} values={values} errors={{}} canTakeOrders={canTakeOrders(c.env.EMAIL, shell.settings)} />,
  );
});

function validateCheckout(form: FormData, emailRequired: boolean): { values: CheckoutValues; errors: CheckoutErrors } {
  const values: CheckoutValues = {
    name: text(form, 'name', 100),
    phone: text(form, 'phone', 20),
    email: text(form, 'email', 254) || null,
    address: text(form, 'address', 500),
    notes: text(form, 'notes', 500),
  };
  const errors: CheckoutErrors = {};
  if (values.name.length < 2) errors.name = 'Please enter your name.';
  if (!isPhone(values.phone)) errors.phone = 'Please enter a valid phone number.';
  if (!values.email) {
    if (emailRequired) errors.email = 'Please enter your email. We will send a code to it to confirm your order.';
  } else if (!isEmail(values.email)) errors.email = 'That email address does not look right.';
  if (values.address.length < 8) errors.address = 'Please enter the full delivery address.';
  return { values, errors };
}

function codeNotSent(outcome: Extract<CodeSendOutcome, { ok: false }>, email: string): string {
  return outcome.addressProblem
    ? `We could not deliver a code to ${email}. Please check the address, or use another one.`
    : 'We could not send your confirmation code just now. Please try again in a few minutes.';
}

const TURNSTILE_MESSAGES: Record<Extract<TurnstileResult, { ok: false }>['reason'], string> = {
  missing: 'Please complete the security check above the button, then try again.',
  rejected: 'The security check did not go through. Please try again.',
  unavailable: 'We could not run the security check just now. Please try again in a moment.',
};

/** Once an order exists: its emails go out in the background, the cart empties and the shopper sees the order. */
function orderPlaced(c: Ctx, order: Order, settings: Settings): Response {
  const store = c.get('store');
  const origin = new URL(c.req.url).origin;
  // The outcome is recorded on the order for the admin.
  c.executionCtx.waitUntil(
    sendOrderEmails(c.env.EMAIL, order, settings, origin)
      .then((outcome) => store.setOrderNotification(order.id, outcome.notification))
      .catch((err: unknown) => {
        console.error(JSON.stringify({ message: 'order notification bookkeeping failed', orderId: order.id, error: err instanceof Error ? err.message : String(err) }));
      }),
  );
  writeCart(c, new Map());
  if (readPendingId(c)) writePendingId(c, null);
  return c.redirect(`/order/${order.id}?placed=1`);
}

store.post('/checkout', async (c) => {
  const form = await c.req.formData();
  const { shell, cart, lines, totals } = await loadCheckout(c);
  if (lines.length === 0 || !shell.settings.storeOpen) return c.redirect('/cart');
  const { settings } = shell;
  const { values, errors } = validateCheckout(form, settings.confirmEmail);
  const open = canTakeOrders(c.env.EMAIL, settings);
  const retry = (errs: CheckoutErrors, status: 400 | 403 | 409 | 429 | 502 | 503) =>
    c.html(<CheckoutPage shell={shell} lines={lines} totals={totals} values={values} errors={errs} canTakeOrders={open} />, status);
  if (Object.keys(errors).length > 0) return retry(errors, 400);
  if (!open) return retry({}, 503);

  const store = c.get('store');
  // The bot check comes before anything with a cost: placing an order, or emailing a code.
  if (settings.turnstileEnabled) {
    const check = await verifyTurnstile(await store.getTurnstileSecret(), text(form, TURNSTILE_FIELD, 2048), c.req.header('cf-connecting-ip') ?? null);
    if (!check.ok) {
      const log = check.reason === 'unavailable' ? console.error : console.warn;
      log(JSON.stringify({ message: 'turnstile check failed', reason: check.reason, errorCodes: check.errorCodes }));
      return retry({ form: TURNSTILE_MESSAGES[check.reason] }, check.reason === 'unavailable' ? 503 : 403);
    }
  }

  const details = { customer: { name: values.name, phone: values.phone, email: values.email, address: values.address }, notes: values.notes };
  if (!settings.confirmEmail) {
    const result = await store.placeOrder({ ...details, items: [...cart].map(([productId, qty]) => ({ productId, qty })) });
    if (!result.ok) {
      if (result.code === 'closed' || result.code === 'empty') return c.redirect('/cart');
      return retry({ form: result.message }, 409);
    }
    return orderPlaced(c, result.order, settings);
  }

  const started = await store.startCheckout(details, readPendingId(c));
  if (!started.ok) return retry({ email: started.message }, 429);

  const { email } = started.pending.customer;
  const sent = await sendVerificationCode(c.env.EMAIL, settings, email, started.otp, OTP_TTL_MINUTES);
  if (!sent.ok) return retry(sent.addressProblem ? { email: codeNotSent(sent, email) } : { form: codeNotSent(sent, email) }, 502);

  writePendingId(c, started.pending.id);
  return c.redirect('/checkout/verify');
});

type VerifyStatus = 200 | 400 | 409 | 429 | 502 | 503;

/** Shows the code step for the shopper's pending checkout, or sends them back a step when there is nothing to confirm. */
async function showVerifyPage(c: Ctx, messages: { notice?: string; error?: string } = {}, status: VerifyStatus = 200) {
  const pendingId = readPendingId(c);
  const [{ shell, lines, totals }, pending] = await Promise.all([
    loadCheckout(c),
    pendingId ? c.get('store').getPendingCheckout(pendingId) : null,
  ]);
  if (lines.length === 0 || !shell.settings.storeOpen) return c.redirect('/cart');
  if (!pending) return c.redirect('/checkout');
  return c.html(<VerifyEmailPage shell={shell} lines={lines} totals={totals} pending={pending} {...messages} />, status);
}

store.get('/checkout/verify', (c) => showVerifyPage(c, c.req.query('resent') === '1' ? { notice: 'We sent you a new code.' } : {}));

store.post('/checkout/verify', async (c) => {
  const pendingId = readPendingId(c);
  if (!pendingId) return c.redirect('/checkout');
  const otp = parseOtp(text(await c.req.formData(), 'code', 20));
  if (!otp) return showVerifyPage(c, { error: `Please enter the ${OTP_DIGITS}-digit code from the email.` }, 400);

  const { shell, cart, lines } = await loadCheckout(c);
  if (lines.length === 0 || !shell.settings.storeOpen) return c.redirect('/cart');
  const store = c.get('store');
  const result = await store.confirmCheckout(pendingId, otp, [...cart].map(([productId, qty]) => ({ productId, qty })));
  if (!result.ok) {
    // The cart cookie is untouched on every path here: nothing was ordered.
    if (result.code === 'missing') return c.redirect('/checkout');
    if (result.code === 'closed' || result.code === 'empty') return c.redirect('/cart');
    return showVerifyPage(c, { error: result.message }, result.code === 'unavailable' ? 409 : 400);
  }
  return orderPlaced(c, result.order, shell.settings);
});

store.post('/checkout/resend', async (c) => {
  const pendingId = readPendingId(c);
  if (!pendingId) return c.redirect('/checkout');
  // No code for a checkout that could not become an order anyway.
  const { shell, lines } = await loadCheckout(c);
  if (lines.length === 0 || !shell.settings.storeOpen) return c.redirect('/cart');
  const { settings } = shell;
  if (!canSendCodes(c.env.EMAIL, settings)) return showVerifyPage(c, { error: 'We could not send a new code just now. Please try again later.' }, 503);

  const store = c.get('store');
  const issued = await store.resendCheckoutCode(pendingId);
  if (!issued.ok) {
    if (issued.code === 'missing') return c.redirect('/checkout');
    return showVerifyPage(c, { error: issued.message }, 429);
  }
  writePendingId(c, pendingId); // a new code gives the pending checkout, and so the cookie, a new lease of life
  const { email } = issued.pending.customer;
  const sent = await sendVerificationCode(c.env.EMAIL, settings, email, issued.otp, OTP_TTL_MINUTES);
  if (!sent.ok) return showVerifyPage(c, { error: codeNotSent(sent, email) }, 502);
  return c.redirect('/checkout/verify?resent=1');
});

store.get('/sitemap.xml', async (c) => {
  const origin = new URL(c.req.url).origin;
  const [categories, products] = await Promise.all([c.get('store').listCategories(), c.get('store').listProducts({ activeOnly: true })]);
  const urls = ['/', '/products', ...categories.map((cat) => `/c/${cat.slug}`), ...products.map((p) => `/p/${p.slug}`)];
  const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${escape(origin + u)}</loc></url>`)
    .join('\n')}\n</urlset>\n`;
  return c.body(body, 200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
});

store.get('/order/:id', async (c) => {
  const [shell, order] = await Promise.all([loadShell(c), c.get('store').getOrder(c.req.param('id'))]);
  if (!order) return c.html(<NotFoundPage />, 404);
  return c.html(<OrderPage shell={shell} order={order} justPlaced={c.req.query('placed') === '1'} />);
});

export default store;
