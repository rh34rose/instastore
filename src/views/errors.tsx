import type { FC } from 'hono/jsx';
import { Document } from './document';

const Plain: FC<{ title: string; children?: unknown }> = ({ title, children }) => (
  <Document title={title} bodyClass="plain">
    <main class="plain-card">
      <h1>{title}</h1>
      {children}
    </main>
  </Document>
);

export const NotFoundPage: FC<{ home?: string }> = ({ home = '/' }) => (
  <Plain title="Page not found">
    <p>The page you are looking for does not exist.</p>
    <p>
      <a href={home}>Back to the store</a>
    </p>
  </Plain>
);

export const ErrorPage: FC = () => (
  <Plain title="Something went wrong">
    <p>Sorry, we could not complete that. Please try again in a moment.</p>
    <p>
      <a href="/">Back to the store</a>
    </p>
  </Plain>
);

export const ForbiddenPage: FC<{ title?: string; children?: unknown }> = ({ title = 'Access denied', children }) => (
  <Plain title={title}>{children}</Plain>
);

/** Shown for /admin when the Access variables are not set. */
export const AccessNotConfigured: FC = () => (
  <Plain title="Admin panel is locked">
    <p>
      The admin panel is protected by <strong>Cloudflare Access</strong>, but this deployment does not know which Access
      application to trust yet.
    </p>
    <ol>
      <li>
        In <a href="https://one.dash.cloudflare.com/">Zero Trust</a>, create a self-hosted Access application for
        your store domain with the path <code>/admin</code>, and a policy allowing your email.
      </li>
      <li>
        Copy the application's <strong>Audience (AUD) tag</strong> and your <strong>team domain</strong>.
      </li>
      <li>
        Set them as the GitHub repository variables <code>ACCESS_AUD</code> and <code>ACCESS_TEAM_DOMAIN</code> and
        re-run the deploy workflow.
      </li>
    </ol>
    <p>The README has the full walkthrough.</p>
  </Plain>
);

/** Shown for /admin when the request carries no valid Access token. */
export const AccessDenied: FC<{ reason?: string }> = ({ reason }) => (
  <Plain title="Sign in required">
    <p>
      The admin panel can only be opened through Cloudflare Access. Visit <code>/admin</code> on the store domain
      that has the Access application, and sign in when prompted.
    </p>
    {reason ? (
      <p class="muted">
        Details: <code>{reason}</code>
      </p>
    ) : null}
  </Plain>
);
