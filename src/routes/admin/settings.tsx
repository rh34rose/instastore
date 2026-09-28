import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { sendTestEmail } from '../../email';
import { checkbox, files, isEmail, text } from '../../forms';
import { parseMoney } from '../../money';
import { checkTurnstileSecret } from '../../turnstile';
import type { Settings } from '../../types';
import { safeColour } from '../../views/document';
import { SettingsPage, settingsToForm, type SettingsErrors, type SettingsFormValues } from '../../views/admin/settings';
import { loadAdminShell, redirectWithFlash, storeUploads } from './shared';

const settingsRoutes = new Hono<AppEnv>();

function readSettingsForm(form: FormData): SettingsFormValues {
  return {
    storeName: text(form, 'storeName', 80),
    tagline: text(form, 'tagline', 140),
    description: text(form, 'description', 2000),
    announcement: text(form, 'announcement', 140),
    accentColor: text(form, 'accentColor', 7),
    currency: text(form, 'currency', 10).toUpperCase(),
    locale: text(form, 'locale', 20),
    deliveryFee: text(form, 'deliveryFee', 20),
    freeDeliveryOver: text(form, 'freeDeliveryOver', 20),
    storeOpen: checkbox(form, 'storeOpen'),
    closedMessage: text(form, 'closedMessage', 200),
    checkoutNote: text(form, 'checkoutNote', 500),
    thankYouMessage: text(form, 'thankYouMessage', 500),
    contactPhone: text(form, 'contactPhone', 30),
    contactEmail: text(form, 'contactEmail', 254),
    contactAddress: text(form, 'contactAddress', 300),
    notifyEmail: text(form, 'notifyEmail', 254),
    fromEmail: text(form, 'fromEmail', 254),
    fromName: text(form, 'fromName', 80),
    confirmEmail: checkbox(form, 'confirmEmail'),
    turnstileEnabled: checkbox(form, 'turnstileEnabled'),
    turnstileSiteKey: text(form, 'turnstileSiteKey', 100),
    turnstileSecretKey: text(form, 'turnstileSecretKey', 200),
  };
}

function isLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

/** What validation needs to know beyond the form itself. */
interface SettingsContext {
  emailBindingPresent: boolean;
  turnstileSecretSaved: boolean;
}

const TURNSTILE_KEY = /^[\w-]+$/;

function validateSettings(v: SettingsFormValues, ctx: SettingsContext): { patch: Partial<Settings>; errors: SettingsErrors } {
  const errors: SettingsErrors = {};
  if (!v.storeName) errors.storeName = 'Store name is required.';
  if (!/^[A-Z]{3}$/.test(v.currency)) errors.currency = 'Use a three-letter currency code such as INR or USD.';
  if (!isLocale(v.locale)) errors.locale = 'Use a locale such as en-IN or en-US.';
  if (v.accentColor && safeColour(v.accentColor, '') === '') errors.accentColor = 'Use a hex colour like #1f6f5f.';
  const currency = errors.currency ? 'USD' : v.currency;
  const deliveryFee = parseMoney(v.deliveryFee || '0', currency);
  if (deliveryFee === null) errors.deliveryFee = 'Enter an amount, e.g. 40 or 0.';
  const freeDeliveryOver = v.freeDeliveryOver === '' ? null : parseMoney(v.freeDeliveryOver, currency);
  if (freeDeliveryOver === undefined || (v.freeDeliveryOver !== '' && freeDeliveryOver === null)) errors.freeDeliveryOver = 'Enter an amount or leave empty.';
  for (const key of ['contactEmail', 'notifyEmail', 'fromEmail'] as const) {
    if (v[key] && !isEmail(v[key])) errors[key] = 'That email address does not look right.';
  }
  // With confirmation on, no email means no orders: refuse the combinations that cannot send.
  if (v.confirmEmail && !ctx.emailBindingPresent) errors.confirmEmail = 'Codes cannot be sent: the EMAIL binding is missing from wrangler.jsonc.';
  else if (v.confirmEmail && !v.fromEmail) errors.confirmEmail = 'Codes are sent from the sender address. Set one under Order emails first.';
  if (v.turnstileSiteKey && !TURNSTILE_KEY.test(v.turnstileSiteKey)) errors.turnstileSiteKey = 'That does not look like a site key. Copy it again from your widget.';
  if (v.turnstileSecretKey && !TURNSTILE_KEY.test(v.turnstileSecretKey)) errors.turnstileSecretKey = 'That does not look like a secret key. Copy it again from your widget.';
  if (v.turnstileEnabled && !v.turnstileSiteKey) errors.turnstileSiteKey = 'Enter the site key of your Turnstile widget.';
  if (v.turnstileEnabled && !v.turnstileSecretKey && !ctx.turnstileSecretSaved) errors.turnstileSecretKey = 'Enter the secret key of your Turnstile widget.';
  const patch: Partial<Settings> = {
    storeName: v.storeName,
    tagline: v.tagline,
    description: v.description,
    announcement: v.announcement,
    accentColor: safeColour(v.accentColor),
    currency: v.currency,
    locale: v.locale,
    deliveryFee: deliveryFee ?? 0,
    freeDeliveryOver: freeDeliveryOver ?? null,
    storeOpen: v.storeOpen,
    closedMessage: v.closedMessage,
    checkoutNote: v.checkoutNote,
    thankYouMessage: v.thankYouMessage,
    contactPhone: v.contactPhone,
    contactEmail: v.contactEmail,
    contactAddress: v.contactAddress,
    notifyEmail: v.notifyEmail,
    fromEmail: v.fromEmail,
    fromName: v.fromName,
    confirmEmail: v.confirmEmail,
    turnstileEnabled: v.turnstileEnabled,
    turnstileSiteKey: v.turnstileSiteKey,
  };
  return { patch, errors };
}

settingsRoutes.get('/admin/settings', async (c) => {
  const [shell, turnstileSecretSaved] = await Promise.all([loadAdminShell(c), c.get('store').hasTurnstileSecret()]);
  return c.html(
    <SettingsPage
      shell={shell}
      values={settingsToForm(shell.settings)}
      errors={{}}
      logoImageId={shell.settings.logoImageId}
      emailBindingPresent={'EMAIL' in c.env}
      turnstileSecretSaved={turnstileSecretSaved}
    />,
  );
});

settingsRoutes.post('/admin/settings', async (c) => {
  const form = await c.req.formData();
  const values = readSettingsForm(form);
  const store = c.get('store');
  const [shell, turnstileSecretSaved] = await Promise.all([loadAdminShell(c), store.hasTurnstileSecret()]);
  const emailBindingPresent = 'EMAIL' in c.env;
  const { patch, errors } = validateSettings(values, { emailBindingPresent, turnstileSecretSaved });

  // A wrong secret would turn every shopper away, so a new one is kept only once Cloudflare recognises it.
  const newSecret = values.turnstileSecretKey;
  if (Object.keys(errors).length === 0 && newSecret) {
    const verdict = await checkTurnstileSecret(newSecret);
    if (verdict === 'invalid') errors.turnstileSecretKey = 'Cloudflare does not recognise this secret key. Copy it again from your widget.';
    if (verdict === 'unknown') errors.turnstileSecretKey = 'Could not reach Cloudflare to check the secret key. Please try again.';
  }

  // Images change only when the rest of the form is valid, so a rejected
  // form never deletes the logo the saved settings still point at.
  let logoImageId = shell.settings.logoImageId;
  if (Object.keys(errors).length === 0) {
    const [logo] = files(form, 'logo');
    if (logo) {
      const upload = await storeUploads(store, [logo]);
      if (!upload.ok) errors.logo = upload.error;
      else {
        if (logoImageId) await store.deleteImage(logoImageId);
        logoImageId = upload.ids[0] ?? null;
      }
    } else if (checkbox(form, 'removeLogo') && logoImageId) {
      await store.deleteImage(logoImageId);
      logoImageId = null;
    }
  }

  if (Object.keys(errors).length > 0) {
    return c.html(
      <SettingsPage
        shell={shell}
        values={values}
        errors={errors}
        logoImageId={logoImageId}
        emailBindingPresent={emailBindingPresent}
        turnstileSecretSaved={turnstileSecretSaved}
      />,
      400,
    );
  }
  // The secret first: the settings may switch the check on.
  if (newSecret) await store.setTurnstileSecret(newSecret);
  await store.updateSettings({ ...patch, logoImageId });
  return redirectWithFlash(c, '/admin/settings', 'saved');
});

settingsRoutes.post('/admin/settings/test-email', async (c) => {
  const settings = await c.get('store').getSettings();
  if (!c.env.EMAIL || !settings.notifyEmail || !settings.fromEmail) return redirectWithFlash(c, '/admin/settings', 'email-not-configured');
  try {
    await sendTestEmail(c.env.EMAIL, settings, new URL(c.req.url).origin);
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ message: 'test email failed', error: code }));
    const [shell, turnstileSecretSaved] = await Promise.all([loadAdminShell(c), c.get('store').hasTurnstileSecret()]);
    shell.flash = { kind: 'error', text: `Sending failed: ${code}. ${EMAIL_HINTS[code] ?? 'See the README section on email setup.'}` };
    return c.html(
      <SettingsPage
        shell={shell}
        values={settingsToForm(settings)}
        errors={{}}
        logoImageId={settings.logoImageId}
        emailBindingPresent
        turnstileSecretSaved={turnstileSecretSaved}
      />,
      502,
    );
  }
  return redirectWithFlash(c, '/admin/settings', 'email-sent');
});

/** Friendlier explanations for the Email Sending error codes an owner is likely to hit. */
const EMAIL_HINTS: Record<string, string> = {
  E_SENDER_NOT_VERIFIED: 'The sender domain is not onboarded to Email Sending yet. Onboard it in the Cloudflare dashboard (Email Service → Email Sending).',
  E_SENDER_DOMAIN_NOT_AVAILABLE: 'The sender domain is not available for sending. Finish onboarding it in Email Sending.',
  E_RECIPIENT_NOT_ALLOWED: 'The recipient is not in the allowed list for this domain.',
  E_RECIPIENT_SUPPRESSED: 'This recipient previously bounced or reported spam and is suppressed.',
  E_RATE_LIMIT_EXCEEDED: 'Too many emails were sent recently. Try again in a minute.',
  E_DAILY_LIMIT_EXCEEDED: 'The daily sending limit was reached.',
};

export default settingsRoutes;
