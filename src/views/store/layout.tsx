import type { FC, PropsWithChildren } from 'hono/jsx';
import type { Category, Settings } from '../../types';
import { Document } from '../document';

/** Everything the storefront chrome needs, loaded once per request. */
export interface Shell {
  settings: Settings;
  categories: Category[];
  cartCount: number;
  /** Current path, used to highlight the active nav link. */
  path: string;
}

interface StorePageProps {
  shell: Shell;
  /** Page title; the store name is appended automatically. */
  title?: string;
  description?: string;
  head?: unknown;
  /** Adds a class to <main>, e.g. "narrow" for forms. */
  mainClass?: string;
}

export const StorePage: FC<PropsWithChildren<StorePageProps>> = ({ shell, title, description, head, mainClass, children }) => {
  const { settings, categories, cartCount, path } = shell;
  const fullTitle = title ? `${title} – ${settings.storeName}` : `${settings.storeName}${settings.tagline ? ` – ${settings.tagline}` : ''}`;
  return (
    <Document
      title={fullTitle}
      description={description ?? settings.description ?? settings.tagline}
      accentColor={settings.accentColor}
      head={
        <>
          {head}
          <script src="/store.js" defer></script>
        </>
      }
    >
      {settings.announcement ? <div class="announcement">{settings.announcement}</div> : null}
      <header class="site-header">
        <div class="container header-row">
          <a href="/" class="brand">
            {settings.logoImageId ? <img src={`/img/${settings.logoImageId}`} alt="" class="brand-logo" /> : null}
            <span>{settings.storeName}</span>
          </a>
          <form action="/products" method="get" class="search" role="search">
            <input type="search" name="q" placeholder="Search products" aria-label="Search products" />
          </form>
          <a href="/cart" class={`cart-link${path === '/cart' ? ' active' : ''}`}>
            Cart{cartCount > 0 ? <span class="badge">{cartCount}</span> : null}
          </a>
        </div>
        <nav class="container nav" aria-label="Categories">
          <a href="/products" class={path === '/products' ? 'active' : ''}>
            All products
          </a>
          {categories.map((cat) => (
            <a href={`/c/${cat.slug}`} class={path === `/c/${cat.slug}` ? 'active' : ''}>
              {cat.name}
            </a>
          ))}
        </nav>
      </header>
      <main class={`container${mainClass ? ` ${mainClass}` : ''}`}>{children}</main>
      <footer class="site-footer">
        <div class="container footer-grid">
          <div>
            <strong>{settings.storeName}</strong>
            {settings.tagline ? <p class="muted">{settings.tagline}</p> : null}
          </div>
          {settings.contactPhone || settings.contactEmail || settings.contactAddress ? (
            <div>
              <strong>Contact</strong>
              {settings.contactPhone ? (
                <p>
                  <a href={`tel:${settings.contactPhone.replace(/\s+/g, '')}`}>{settings.contactPhone}</a>
                </p>
              ) : null}
              {settings.contactEmail ? (
                <p>
                  <a href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a>
                </p>
              ) : null}
              {settings.contactAddress ? <p class="muted pre-line">{settings.contactAddress}</p> : null}
            </div>
          ) : null}
          <div>
            <strong>Payment</strong>
            <p class="muted">Cash on delivery. Pay when your order arrives.</p>
          </div>
        </div>
      </footer>
    </Document>
  );
};
