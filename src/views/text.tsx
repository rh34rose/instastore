import type { FC } from 'hono/jsx';

/** Renders user-typed multi-line text: blank lines become paragraphs, single newlines become <br>. */
export const Paragraphs: FC<{ text: string; class?: string }> = (props) => {
  const blocks = props.text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  return (
    <>
      {blocks.map((block) => (
        <p class={props.class}>
          {block.split('\n').map((line, i) => (
            <>
              {i > 0 ? <br /> : null}
              {line}
            </>
          ))}
        </p>
      ))}
    </>
  );
};

export function formatDate(ms: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}
