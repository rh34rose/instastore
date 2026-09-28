import { raw } from 'hono/html';
import type { FC, PropsWithChildren } from 'hono/jsx';

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export function safeColour(value: string | undefined, fallback = '#1f6f5f'): string {
  return value && HEX_COLOUR.test(value) ? value : fallback;
}

export interface DocumentProps {
  title: string;
  description?: string;
  accentColor?: string;
  bodyClass?: string;
  /** Extra tags for <head>, e.g. canonical links. */
  head?: unknown;
}

/** The HTML shell shared by every page: doctype, head, stylesheet, theme colour. */
export const Document: FC<PropsWithChildren<DocumentProps>> = (props) => (
  <>
    {raw('<!DOCTYPE html>')}
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        {props.description ? <meta name="description" content={props.description} /> : null}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
        <style>{raw(`:root{--accent:${safeColour(props.accentColor)}}`)}</style>
        {props.head}
      </head>
      <body class={props.bodyClass}>{props.children}</body>
    </html>
  </>
);
