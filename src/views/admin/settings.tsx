import type { FC } from 'hono/jsx';
import { toMajorString } from '../../money';
import { TURNSTILE_SCRIPT } from '../../turnstile';
import type { Settings } from '../../types';
import { AdminPage, Checkbox, Field, TextArea, TextInput, type AdminShell } from './layout';

/** Settings as they appear in the form: every value a string, money as decimals. */
export interface SettingsFormValues {
  storeName: string;
  tagline: string;
  description: string;
  announcement: string;
  accentColor: string;
  currency: string;
  locale: string;
  deliveryFee: string;
  freeDeliveryOver: string;
  storeOpen: boolean;
  closedMessage: string;
  checkoutNote: string;
  thankYouMessage: string;
  contactPhone: string;
  contactEmail: string;
  contactAddress: string;
  notifyEmail: string;
  fromEmail: string;
  fromName: string;
  confirmEmail: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  /** Only ever filled from the form: a saved secret is never sent back to the browser. */
  turnstileSecretKey: string;
}

export type SettingsErrors = Partial<Record<keyof SettingsFormValues | 'logo', string>>;

export function settingsToForm(s: Settings): SettingsFormValues {
  return {
    storeName: s.storeName,
    tagline: s.tagline,
    description: s.description,
    announcement: s.announcement,
    accentColor: s.accentColor,
    currency: s.currency,
    locale: s.locale,
    deliveryFee: toMajorString(s.deliveryFee, s.currency),
    freeDeliveryOver: s.freeDeliveryOver === null ? '' : toMajorString(s.freeDeliveryOver, s.currency),
    storeOpen: s.storeOpen,
    closedMessage: s.closedMessage,
    checkoutNote: s.checkoutNote,
    thankYouMessage: s.thankYouMessage,
    contactPhone: s.contactPhone,
    contactEmail: s.contactEmail,
    contactAddress: s.contactAddress,
    notifyEmail: s.notifyEmail,
    fromEmail: s.fromEmail,
    fromName: s.fromName,
    confirmEmail: s.confirmEmail,
    turnstileEnabled: s.turnstileEnabled,
    turnstileSiteKey: s.turnstileSiteKey,
    turnstileSecretKey: '',
  };
}

/** Asked before email confirmation can be switched on: on the free plan it would stop every order. */
const PAID_PLAN_CONFIRM = [
  'Email confirmation works only if your Cloudflare account is on the Workers Paid plan.',
  'On the free plan, Cloudflare emails only your own verified addresses, so shoppers would never receive their codes and nobody could place an order.',
  'Press OK only if your account is on the Workers Paid plan.',
].join('\n\n');

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'MYR', 'PHP', 'NGN', 'KES', 'ZAR', 'BRL', 'MXN'];
const LOCALES = ['en-IN', 'en-US', 'en-GB', 'en-AU', 'en-CA', 'en-SG', 'en-AE', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ja-JP', 'hi-IN'];

export const SettingsPage: FC<{
  shell: AdminShell;
  values: SettingsFormValues;
  errors: SettingsErrors;
  logoImageId: string | null;
  emailBindingPresent: boolean;
  turnstileSecretSaved: boolean;
}> = ({ shell, values, errors, logoImageId, emailBindingPresent, turnstileSecretSaved }) => (
  <AdminPage shell={shell} title="Settings" head={shell.settings.turnstileSiteKey ? <script src={TURNSTILE_SCRIPT} async defer></script> : undefined}>
    <form method="post" action="/admin/settings" enctype="multipart/form-data" class="form-sections">
      <section class="panel">
        <h2>Store</h2>
        <Field name="storeName" label="Store name" error={errors.storeName}>
          <TextInput name="storeName" value={values.storeName} required maxlength={80} />
        </Field>
        <Field name="tagline" label="Tagline" hint="One line under the store name.">
          <TextInput name="tagline" value={values.tagline} maxlength={140} />
        </Field>
        <Field name="description" label="About" hint="Shown on the home page. Blank lines start new paragraphs.">
          <TextArea name="description" value={values.description} rows={4} maxlength={2000} />
        </Field>
        <Field name="announcement" label="Announcement bar" hint="Short message at the top of every page, e.g. delivery timings. Leave empty to hide.">
          <TextInput name="announcement" value={values.announcement} maxlength={140} />
        </Field>
        <div class="field-row">
          <Field name="accentColor" label="Accent colour" error={errors.accentColor}>
            <input id="f-accentColor" type="color" name="accentColor" value={values.accentColor} />
          </Field>
          <Field name="logo" label="Logo" error={errors.logo} hint="Optional. Shown next to the store name.">
            {logoImageId ? (
              <div class="logo-preview">
                <img src={`/img/${logoImageId}`} alt="Current logo" />
                <label class="check">
                  <input type="checkbox" name="removeLogo" /> <span>Remove logo</span>
                </label>
              </div>
            ) : null}
            <input id="f-logo" type="file" name="logo" accept="image/*" data-resize="512" />
          </Field>
        </div>
      </section>

      <section class="panel">
        <h2>Money &amp; delivery</h2>
        <div class="field-row">
          <Field name="currency" label="Currency" error={errors.currency} hint="ISO code. Existing prices are not converted when you change this.">
            <TextInput name="currency" value={values.currency} list="currency-list" maxlength={3} required />
            <datalist id="currency-list">
              {CURRENCIES.map((c) => (
                <option value={c} />
              ))}
            </datalist>
          </Field>
          <Field name="locale" label="Number format" error={errors.locale} hint="Locale used to format prices and dates.">
            <TextInput name="locale" value={values.locale} list="locale-list" maxlength={20} required />
            <datalist id="locale-list">
              {LOCALES.map((l) => (
                <option value={l} />
              ))}
            </datalist>
          </Field>
        </div>
        <div class="field-row">
          <Field name="deliveryFee" label="Delivery fee" error={errors.deliveryFee} hint="Added to every order. 0 for free delivery.">
            <TextInput name="deliveryFee" value={values.deliveryFee} type="number" step="0.01" min="0" />
          </Field>
          <Field name="freeDeliveryOver" label="Free delivery over" error={errors.freeDeliveryOver} hint="Orders at or above this subtotal ship free. Leave empty to disable.">
            <TextInput name="freeDeliveryOver" value={values.freeDeliveryOver} type="number" step="0.01" min="0" />
          </Field>
        </div>
      </section>

      <section class="panel">
        <h2>Ordering</h2>
        <Checkbox name="storeOpen" label="Store is open for orders" checked={values.storeOpen} hint="Untick to pause orders (e.g. holidays). Shoppers can still browse." />
        <Field name="closedMessage" label="Message when closed">
          <TextInput name="closedMessage" value={values.closedMessage} maxlength={200} />
        </Field>
        <Field name="checkoutNote" label="Checkout note" hint="Shown above the checkout form, e.g. delivery areas or timings.">
          <TextArea name="checkoutNote" value={values.checkoutNote} rows={2} maxlength={500} />
        </Field>
        <Field name="thankYouMessage" label="Thank-you message" hint="Shown after an order is placed.">
          <TextArea name="thankYouMessage" value={values.thankYouMessage} rows={2} maxlength={500} />
        </Field>
      </section>

      <section class="panel">
        <h2>Contact details</h2>
        <p class="muted small">Shown in the store footer and on order confirmations.</p>
        <div class="field-row">
          <Field name="contactPhone" label="Phone">
            <TextInput name="contactPhone" value={values.contactPhone} type="tel" maxlength={30} />
          </Field>
          <Field name="contactEmail" label="Email" error={errors.contactEmail}>
            <TextInput name="contactEmail" value={values.contactEmail} type="email" maxlength={254} />
          </Field>
        </div>
        <Field name="contactAddress" label="Address">
          <TextArea name="contactAddress" value={values.contactAddress} rows={3} maxlength={300} />
        </Field>
      </section>

      <section class="panel" id="email">
        <h2>Order emails</h2>
        <p class="muted small">
          Every new order is emailed to the notification address, and to the customer when they give an email. The sender must
          be on a domain onboarded to Cloudflare Email Sending (see README). It also sends shoppers their codes when email
          confirmation is on (below).
        </p>
        {!emailBindingPresent ? <div class="notice notice-error">The EMAIL binding is missing from wrangler.jsonc, so emails cannot be sent.</div> : null}
        <Field name="notifyEmail" label="Send order notifications to" error={errors.notifyEmail}>
          <TextInput name="notifyEmail" value={values.notifyEmail} type="email" maxlength={254} placeholder="you@example.com" />
        </Field>
        <div class="field-row">
          <Field name="fromEmail" label="Sender address" error={errors.fromEmail} hint="e.g. orders@yourdomain.com">
            <TextInput name="fromEmail" value={values.fromEmail} type="email" maxlength={254} />
          </Field>
          <Field name="fromName" label="Sender name">
            <TextInput name="fromName" value={values.fromName} maxlength={80} placeholder={values.storeName} />
          </Field>
        </div>
      </section>

      <section class="panel" id="protection">
        <h2>Checkout protection</h2>
        <Checkbox
          name="confirmEmail"
          label="Confirm shoppers' email addresses with a one-time code"
          checked={values.confirmEmail}
          error={errors.confirmEmail}
          hint="Before an order is placed, the shopper gets a 6-digit code from the sender address above and types it in. Cuts fake orders. Works only on the Cloudflare Workers Paid plan: on the free plan Cloudflare emails only your own verified addresses, so shoppers would never receive a code and could not order."
          confirm={PAID_PLAN_CONFIRM}
        />

        <h3>Bot check (Cloudflare Turnstile)</h3>
        <p class="muted small">
          Turnstile makes sure a person, not a script, is ordering, usually without them having to do anything. In the Cloudflare
          dashboard open <strong>Turnstile → Add widget</strong>, add your store's domain, keep the <em>Managed</em> mode, and
          paste the widget's two keys here.
        </p>
        <div class="field-row">
          <Field name="turnstileSiteKey" label="Site key" error={errors.turnstileSiteKey}>
            <TextInput name="turnstileSiteKey" value={values.turnstileSiteKey} maxlength={100} autocomplete="off" />
          </Field>
          <Field
            name="turnstileSecretKey"
            label="Secret key"
            error={errors.turnstileSecretKey}
            hint={turnstileSecretSaved ? 'Saved. Leave empty to keep it.' : 'Checked with Cloudflare when you save, then never shown again.'}
          >
            <TextInput name="turnstileSecretKey" value="" type="password" maxlength={200} autocomplete="new-password" />
          </Field>
        </div>
        <Checkbox
          name="turnstileEnabled"
          label="Ask shoppers to pass the Turnstile check at checkout"
          checked={values.turnstileEnabled}
          hint="Shoppers need JavaScript turned on to pass it."
        />
      </section>

      <div class="actions sticky-actions">
        <button type="submit" class="btn btn-primary">
          Save settings
        </button>
      </div>
    </form>
    <form method="post" action="/admin/settings/test-email" class="panel">
      <h2>Test email</h2>
      <p class="muted small">Sends a test message to the notification address using the saved sender. Save first.</p>
      <button type="submit" class="btn" disabled={!emailBindingPresent || !values.notifyEmail || !values.fromEmail}>
        Send test email
      </button>
    </form>
    {shell.settings.turnstileSiteKey ? (
      <section class="panel">
        <h2>Turnstile preview</h2>
        <p class="muted small">
          The check shoppers see, using the saved site key. It often passes by itself. If it shows an error instead, the site key
          is wrong or this domain is missing from the widget's hostnames.
        </p>
        <div class="cf-turnstile" data-sitekey={shell.settings.turnstileSiteKey} data-action="turnstile-spin-v2" data-theme="light"></div>
      </section>
    ) : null}
  </AdminPage>
);
