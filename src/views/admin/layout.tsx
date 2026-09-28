import type { FC, PropsWithChildren } from 'hono/jsx';
import type { Settings, StoreStats } from '../../types';
import { Document } from '../document';

/** What every admin page needs: who is signed in, the store, and counters for the nav. */
export interface AdminShell {
  settings: Settings;
  stats: StoreStats;
  adminEmail: string;
  path: string;
  flash: Flash | null;
  /** True when running under `npm run dev` without Cloudflare Access. */
  devBypass: boolean;
}

export interface Flash {
  kind: 'success' | 'error' | 'info';
  text: string;
}

/** Messages are keyed, not free text, so nothing from the query string is echoed. */
const FLASHES: Record<string, Flash> = {
  saved: { kind: 'success', text: 'Saved.' },
  created: { kind: 'success', text: 'Created.' },
  deleted: { kind: 'success', text: 'Deleted.' },
  status: { kind: 'success', text: 'Order status updated.' },
  'email-sent': { kind: 'success', text: 'Test email sent. Check the inbox (and spam folder).' },
  'email-not-configured': { kind: 'error', text: 'Save a notification address and a sender address first.' },
  'not-found': { kind: 'error', text: 'That item no longer exists.' },
  'image-too-large': { kind: 'error', text: 'One of the images is too large. Keep each under 1.5 MB.' },
  'image-type': { kind: 'error', text: 'Only JPEG, PNG, WebP and GIF images can be uploaded.' },
};

export function flashFor(key: string | undefined): Flash | null {
  return key ? (FLASHES[key] ?? null) : null;
}

const NAV: { href: string; label: string; match: (path: string) => boolean }[] = [
  { href: '/admin', label: 'Dashboard', match: (p) => p === '/admin' },
  { href: '/admin/orders', label: 'Orders', match: (p) => p.startsWith('/admin/orders') },
  { href: '/admin/products', label: 'Products', match: (p) => p.startsWith('/admin/products') },
  { href: '/admin/categories', label: 'Categories', match: (p) => p.startsWith('/admin/categories') },
  { href: '/admin/settings', label: 'Settings', match: (p) => p.startsWith('/admin/settings') },
];

export const AdminPage: FC<PropsWithChildren<{ shell: AdminShell; title: string; wide?: boolean; head?: unknown }>> = ({ shell, title, wide, head, children }) => (
  <Document
    title={`${title} · Admin · ${shell.settings.storeName}`}
    accentColor={shell.settings.accentColor}
    bodyClass="admin"
    head={
      <>
        <script src="/admin.js" defer></script>
        {head}
      </>
    }
  >
    <aside class="admin-sidebar">
      <a href="/admin" class="admin-brand">
        {shell.settings.storeName}
        <small>Admin</small>
      </a>
      <nav class="admin-nav">
        {NAV.map((item) => (
          <a href={item.href} class={item.match(shell.path) ? 'active' : ''}>
            {item.label}
            {item.label === 'Orders' && shell.stats.orders.new > 0 ? <span class="badge">{shell.stats.orders.new}</span> : null}
          </a>
        ))}
      </nav>
      <div class="admin-user">
        <a href="/" target="_blank" rel="noopener">
          View store ↗
        </a>
        <span class="muted small" title={shell.adminEmail}>
          {shell.adminEmail}
        </span>
        {shell.devBypass ? <span class="pill pill-warn">dev mode</span> : <a href="/cdn-cgi/access/logout" class="small">Sign out</a>}
      </div>
    </aside>
    <main class={`admin-main${wide ? ' wide' : ''}`}>
      <h1>{title}</h1>
      {shell.flash ? (
        <div class={`notice notice-${shell.flash.kind}`} role={shell.flash.kind === 'error' ? 'alert' : 'status'}>
          {shell.flash.text}
        </div>
      ) : null}
      {children}
    </main>
  </Document>
);

// ───────────────────────── Form building blocks ─────────────────────────

export const Field: FC<{ name: string; label: string; error?: string; hint?: string; children?: unknown }> = ({ name, label, error, hint, children }) => (
  <div class={`field${error ? ' has-error' : ''}`}>
    <label for={`f-${name}`}>{label}</label>
    {children}
    {hint ? <small class="muted">{hint}</small> : null}
    {error ? <small class="error">{error}</small> : null}
  </div>
);

export const TextInput: FC<{
  name: string;
  value: string;
  type?: string;
  required?: boolean;
  maxlength?: number;
  placeholder?: string;
  list?: string;
  step?: string;
  min?: string;
  autocomplete?: string;
}> = (p) => (
  <input
    id={`f-${p.name}`}
    name={p.name}
    type={p.type ?? 'text'}
    value={p.value}
    required={p.required}
    maxlength={p.maxlength ?? 200}
    placeholder={p.placeholder}
    list={p.list}
    step={p.step}
    min={p.min}
    autocomplete={p.autocomplete}
  />
);

export const TextArea: FC<{ name: string; value: string; rows?: number; maxlength?: number; hint?: string }> = (p) => (
  <textarea id={`f-${p.name}`} name={p.name} rows={p.rows ?? 4} maxlength={p.maxlength ?? 5000}>
    {p.value}
  </textarea>
);

/** `confirm`: admin.js asks this before the box can be ticked; cancelling leaves it unticked. */
export const Checkbox: FC<{ name: string; label: string; checked: boolean; hint?: string; error?: string; confirm?: string }> = (p) => (
  <label class="check">
    <input type="checkbox" name={p.name} checked={p.checked} data-confirm={p.confirm} />
    <span>
      {p.label}
      {p.hint ? <small class="muted block">{p.hint}</small> : null}
      {p.error ? <small class="error block">{p.error}</small> : null}
    </span>
  </label>
);

export const DeleteForm: FC<{ action: string; label?: string; confirm: string; small?: boolean }> = ({ action, label = 'Delete', confirm, small }) => (
  <form method="post" action={action} class="inline" data-confirm={confirm}>
    <button type="submit" class={`btn btn-danger${small ? ' btn-small' : ''}`}>
      {label}
    </button>
  </form>
);

export const EmptyState: FC<{ children?: unknown }> = ({ children }) => <div class="empty-state">{children}</div>;
