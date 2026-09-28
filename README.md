# instastore

A simple storefront that runs entirely on Cloudflare, made for people who are not developers.

* Multiple categories of products, product photos, search, cart and checkout.
* Orders are **cash on delivery** (for now). Each order is emailed to you and listed in the admin panel.
* Optional **protection against fake orders**: shoppers confirm their email with a one-time code, and/or pass a Cloudflare **Turnstile** bot check. Both are switched on in the admin panel.
* The admin panel is a small CMS at `/admin`: change the store's name, colours, delivery fee, products, photos… save, and the site updates.
* The admin panel is protected by **Cloudflare Zero Trust** (Access), so only the emails you allow can open it.
* Nothing else to run or pay for: the whole store is one Cloudflare Worker with its own built-in storage.

How you get a store: **clone this repo → push it to your GitHub → GitHub deploys it to Cloudflare → set up Access → set up email → open `/admin` and fill in your store.**

---

## Table of contents

1. [Get your store online](#get-your-store-online) (no coding)
2. [Running the store day to day](#running-the-store-day-to-day)
3. [Troubleshooting](#troubleshooting)
4. [For developers](#for-developers)

---

## Get your store online

You need:

* a **GitHub** account,
* a **Cloudflare** account (the free plan runs the store; emailing shoppers — order confirmations and email confirmation codes — needs the **Workers Paid** plan),
* a **domain** added to Cloudflare (for example `shop.example.com` under `example.com`). Cloudflare Access and email sending both need a domain that Cloudflare manages.

Budget about half an hour.

### 1. Put the code in your own GitHub repository

The easiest way is to **fork** this repository on GitHub (the *Fork* button, top right). Alternatively, clone it and push it to a new repository of your own. Either way you end up with `github.com/<you>/instastore`.

### 2. Give GitHub permission to deploy to your Cloudflare account

1. In the Cloudflare dashboard, open **My Profile → API Tokens → Create Token**, and use the **Edit Cloudflare Workers** template. Create the token and copy it. Take this route rather than **Manage account → Account API tokens**: deploying reads the Worker's secrets, and that part of the API turns account-owned tokens away.
2. Find your **Account ID**: open **Workers & Pages** and it is shown in the right-hand column (or in the URL).
3. In your GitHub repository, open **Settings → Secrets and variables → Actions → Secrets** and add two repository secrets:

   | Secret | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from step 1 |
   | `CLOUDFLARE_ACCOUNT_ID` | your account id |

### 3. Deploy

Open the **Actions** tab of your repository, choose the **Deploy** workflow and click **Run workflow** (afterwards, every push to the `deploy` branch deploys automatically — merge `main` into `deploy` when you want the current code to go live).

A minute later the store is live at `https://instastore.<your-subdomain>.workers.dev` (the address is printed at the end of the workflow log, and in the Cloudflare dashboard under **Workers & Pages → instastore**). It is empty and `/admin` is locked. Both are fixed next.

### 4. Give the store your domain

In the Cloudflare dashboard: **Workers & Pages → instastore → Settings → Domains & Routes → Add → Custom domain**, and enter the domain you want, e.g. `shop.example.com`. Cloudflare creates the DNS record for you; it usually works within a minute.

### 5. Protect the admin panel with Zero Trust

1. Open the [Zero Trust dashboard](https://one.dash.cloudflare.com/). The first time, it asks you to pick a **team name** — this becomes your *team domain*, `<team>.cloudflareaccess.com`. The free plan is fine.
2. Go to **Access → Applications → Add an application → Self-hosted**.
   * Application name: `instastore admin`
   * Application domain: your store domain, **path `admin`** (so it protects `shop.example.com/admin`).
   * Session duration: whatever you like (e.g. 24 hours).
3. Add a **policy**: name `Owners`, action *Allow*, rule *Emails* → your email address(es). Leave the identity provider as **One-time PIN** — you will sign in with a code sent to your email.
4. Save the application. Open it again and copy its **Application Audience (AUD) Tag** (Overview / Basic information).
5. Back in GitHub: **Settings → Secrets and variables → Actions → Variables** (the *Variables* tab, not *Secrets*). Add:

   | Variable | Value |
   |---|---|
   | `ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
   | `ACCESS_AUD` | the AUD tag |

6. Run the **Deploy** workflow again (Actions tab → Deploy → Run workflow).

Now open `https://shop.example.com/admin`. Cloudflare asks for your email, sends you a code, and you are in.

> The store does its own check of the Access login on every admin request, so the admin panel stays locked even on the `workers.dev` address, where Access cannot run.

### 6. Set up order emails

Orders are always saved and shown in the admin panel. To also receive them by email, and to be able to turn on email confirmation (step 8):

1. In the Cloudflare dashboard open **Email Service → Email Sending** (under *Compute & AI*), click **Onboard domain**, pick your domain and accept the DNS records it adds.
2. In the admin panel go to **Settings → Order emails**:
   * *Send order notifications to*: your inbox (any address on the Workers Paid plan; on the free plan it must be a verified destination address in your Cloudflare account).
   * *Sender address*: an address on the onboarded domain, e.g. `orders@example.com`. It does not need to exist as a mailbox.
3. Save, then press **Send test email**. If it fails, the message tells you why (most often the domain is not onboarded yet).

On the Workers Paid plan, customers who leave an email at checkout also get a confirmation from the same sender. On the free plan Cloudflare delivers only to [verified destination addresses](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/#destination-addresses) in your account, such as your own inbox, so customers get no email.

### 7. Fill in your store

In the admin panel:

* **Settings**: store name, tagline, colour, logo, currency, delivery fee, free-delivery threshold, contact details, and the message shoppers see after ordering.
* **Categories**: e.g. *Pickles*, *Spice powders*. Optional — products can live without one.
* **Products**: name, description, price, optional "compare-at" price (shown struck through), photos, category. Untick *Visible* to hide a product, or *In stock* to show it as sold out.

Share `https://shop.example.com` and you are open for business.

### 8. Protect checkout from fake orders (optional)

Cash-on-delivery stores attract fake and prank orders. Two checks make them harder; turn on either or both in **Settings → Checkout protection**.

**Confirm shoppers' email addresses.** At checkout the shopper gets a 6-digit code by email and types it in; only then is the order placed. A wrong or expired code places nothing, and the shopper keeps their cart. It needs order emails (step 6) and the **Cloudflare Workers Paid plan**: on the free plan Cloudflare emails only your own verified addresses, so shoppers would never get their codes and **nobody could place an order**. The admin panel asks you to confirm your plan when you tick the box, and the dashboard reminds you while it is on. (*Send test email* goes to your own inbox, so it cannot tell you whether shoppers can be emailed.)

**Turnstile bot check.** Cloudflare's free CAPTCHA replacement, usually invisible to people.

1. In the Cloudflare dashboard go to **Turnstile → Add widget**. Give it a name, add your store's domain (e.g. `shop.example.com`) as a hostname, keep the **Managed** mode, and create it.
2. Copy the widget's **Site key** and **Secret key** into **Settings → Checkout protection**, tick *Ask shoppers to pass the Turnstile check at checkout*, and save. The secret key is checked with Cloudflare as you save, and is never shown again.
3. The **Turnstile preview** at the bottom of the Settings page shows the check as shoppers see it. If it shows an error, the site key is wrong or your domain is missing from the widget's hostnames.

Shoppers need JavaScript turned on to pass the Turnstile check.

---

## Running the store day to day

* **New orders** arrive by email and under **Orders** in the admin panel (the sidebar shows how many are new). Each order has the items, the amount to collect on delivery, the customer's phone (with a WhatsApp link) and address.
* Move orders through **Confirmed → Shipped → Delivered** (or *Cancelled*) so you know where things stand. Customers can see the status on their order page.
* Going on holiday? **Settings → Store is open for orders** — untick it. Shoppers can browse but not order, and see your *closed* message.
* An **announcement bar** (Settings) is handy for "orders placed after 6 pm ship next day".
* Photos are shrunk in your browser before upload, so phone photos are fine. Keep each under 1.5 MB.

---

## Troubleshooting

**"Admin panel is locked" page** — the deploy does not know your Access application yet. Set the `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` repository *variables* (step 5) and run the Deploy workflow again.

**"Sign in required" page** — you reached `/admin` without going through Cloudflare Access. Use your custom domain (step 4), not the `workers.dev` address, and make sure the Access application covers that domain with path `admin`. If it says `wrong_audience`, the `ACCESS_AUD` variable does not match the application; if `wrong_issuer`, check `ACCESS_TEAM_DOMAIN`.

**Test email fails** — the message shows the error code. `E_SENDER_NOT_VERIFIED` means the sender's domain is not onboarded to Email Sending yet (step 6). Also check that the sender address really is on that domain.

**Order shows "Email failed"** in the orders list — same causes as above; the order itself is safe.

**"Shoppers cannot place orders"** on the dashboard, or **"Online ordering is unavailable"** at checkout — email confirmation is on, but the store cannot send the codes. Set the sender address (step 6) and press **Send test email** to check, or turn email confirmation off (step 8).

**Every shopper sees "We could not send your confirmation code just now"** — most often the Cloudflare account is on the Workers Free plan, which can email only your own verified addresses. Move to Workers Paid, or turn email confirmation off (**Settings → Checkout protection**). The exact error is in the Cloudflare dashboard under **Workers & Pages → instastore → Logs**: search for `verification code email failed`.

**A shopper did not get their email code** — codes come from your sender address and sometimes land in spam. The code page has **Send a new code** (once every 30 seconds, and at most 5 codes an hour to one address). A code works for 10 minutes and allows 5 wrong tries; after that they send themselves a new one. Their cart is kept throughout. If checkout says it *could not deliver a code*, that address bounced before or does not exist, and they can go back and use another.

**Shoppers are stopped by the security check** — look at the *Turnstile preview* on the Settings page: an error there means the site key is wrong or your domain is not among the widget's hostnames (fix it in the Cloudflare dashboard under **Turnstile**). If checkout says *"We could not run the security check"* for everyone, the secret key no longer matches the widget (it may have been rotated): paste the current one into Settings. To take orders in the meantime, untick the Turnstile box.

**The Deploy workflow fails** — open the failed step in the Actions tab; the *Check Cloudflare credentials* step names what is wrong. "cannot read the secrets of Worker" means the token is account-owned — make a new one under **My Profile → API Tokens** (step 2). "cannot manage Workers in account …" means `CLOUDFLARE_ACCOUNT_ID` is not your Account ID (a Zone ID is easy to grab by mistake — take the one shown under **Workers & Pages**), or the token does not cover that account. "Repository secret … is not set" means step 2 is incomplete.

**Changed the currency** — prices are not converted; edit them.

---

## For developers

### Stack

* [Cloudflare Workers](https://developers.cloudflare.com/workers/) with static assets, written in TypeScript with [Hono](https://hono.dev/) and server-rendered JSX. No client framework, no build step beyond Wrangler.
* One **Durable Object** (`StoreDO`, SQLite-backed) holds everything: settings, categories, products, images (as blobs) and orders. Strong consistency means what the admin saves is what shoppers see immediately, and there is nothing to provision — no KV/D1/R2 ids to paste anywhere, which keeps "push to deploy" true.
* **Cloudflare Access** JWTs are verified in the Worker (`src/access.ts`) using the team's public keys, so `/admin` fails closed.
* **Cloudflare Email Sending** binding for checkout codes and order emails (`src/email.ts`).
* Optional **Cloudflare Turnstile** on the checkout form, verified server-side with siteverify (`src/turnstile.ts`).
* The cart lives in an HttpOnly cookie, so the storefront works without JavaScript; the small scripts in `public/` only add polish (gallery, photo resizing, confirmations).

```
src/
  index.tsx          Hono app: middleware, routes, error pages; exports StoreDO
  store.ts           StoreDO — schema, migrations, all data access (RPC methods)
  access.ts          Cloudflare Access JWT verification
  middleware.tsx     store stub injection, CSRF guard, admin gate
  email.ts           checkout codes, order notification / confirmation emails
  otp.ts             one-time code generation and limits
  turnstile.ts       Turnstile siteverify, and the secret-key check the admin uses
  cart.ts pricing.ts money.ts forms.ts slug.ts   small pure helpers
  routes/            storefront.tsx, images.ts, admin/{index,settings,catalog,orders}.tsx
  views/             JSX: document.tsx, errors.tsx, store/*, admin/*
public/              styles.css, store.js, admin.js, favicon, robots.txt
test/                vitest (@cloudflare/vitest-pool-workers) — runs inside workerd
.github/workflows/   ci.yml (checks), deploy.yml (checks + deploy)
```

### Local development

```bash
npm install
npm run dev        # http://localhost:8787 — /admin is open on localhost (ACCESS_DEV_BYPASS)
npm test           # unit + end-to-end tests in the Workers runtime
npm run check      # regenerate binding types and type-check
npm run deploy     # deploy from your machine (needs `npx wrangler login`)
```

Local data lives in `.wrangler/state` and survives restarts. Wrangler emulates the email binding locally: sends report success (orders show *Email sent*) but nothing is delivered. It prints each email's subject in the `npm run dev` terminal, and the checkout code is in the subject (`042917 is your … code`), so you can check out locally with email confirmation on; set a sender address in the admin first. To try Turnstile locally, use Cloudflare's [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/): site key `1x00000000000000000000AA` with secret `1x0000000000000000000000000000000AA` always passes, and secret `2x0000000000000000000000000000000AA` always fails. Add `"remote": true` to the `send_email` binding in `wrangler.jsonc` to send real emails from `npm run dev`.

### Configuration

`wrangler.jsonc` needs no per-store edits. Per-store values come from:

* the **admin panel** (everything shoppers see, delivery rules, email addresses, checkout protection including the Turnstile keys);
* GitHub **variables** `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, passed to `wrangler deploy --var` by the workflow (you can also hardcode them in `wrangler.jsonc` `vars`);
* the Cloudflare **dashboard** for the custom domain, Access application, Email Sending domain and Turnstile widget.

### Limits and design notes

* One store per deployment; one Durable Object per store. Plenty for a small business, not for a marketplace.
* Images are stored in the Durable Object (max 1.5 MB each, resized client-side to 1600 px) and cached at the edge for a year under immutable URLs. Swap `putImage`/`getImage` for R2 if you need large galleries.
* Prices are integers in the currency's minor unit; formatting uses `Intl` with the configured locale.
* Only cash on delivery. The order model carries `paymentMethod` so online payments can be added later.
* Order notification failures are recorded on the order rather than retried; the admin can see and act on them.
* With email confirmation on (`confirmEmail`, off by default), checkout is two steps. `POST /checkout` keeps the details as a *pending checkout* in the Durable Object and emails a 6-digit code; `POST /checkout/verify` checks the code and places the order in one synchronous Durable Object call, so a code works once. The cart cookie is cleared only after the order exists, so a failed code never costs the shopper their cart. Codes last 10 minutes, allow 5 wrong tries, can be resent every 30 seconds, and one address gets at most 5 an hour (`src/otp.ts`). They are stored as plain text on purpose: a hash of a 6-digit number is reversed by trying a million candidates, so the limits are what protect them. With it off, `POST /checkout` places the order directly and the email is optional.
* With Turnstile on, `POST /checkout` verifies the widget's token with siteverify before placing an order or emailing a code; a token that is missing or refused re-renders the form (403) and keeps the cart. The site key is a normal setting; the secret key sits in its own row of the Durable Object's `settings` table, outside `Settings`, so it never reaches pages, and the form never sends it back. It is set in the admin panel rather than as a Worker secret so store owners never have to touch GitHub or Wrangler for it, and the admin form checks a new one against siteverify (with a token no widget issues) before saving.

### Contributing

Run `npm run check && npm test` before pushing; CI runs the same checks on every pull request and on `main`, and the Deploy workflow runs them again before deploying. Work lands on `main`; merging `main` into the `deploy` branch is what releases it.
