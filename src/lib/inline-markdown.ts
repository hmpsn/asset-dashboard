interface InlineMarkdownClasses {
  bold: string;
  em: string;
  code: string;
}

const DEFAULT_CLASSES: InlineMarkdownClasses = {
  bold: 'text-[var(--brand-text-bright)]',
  em: 'text-[var(--brand-text)]',
  code: 'bg-[var(--surface-3)] px-1 py-0.5 rounded-[var(--radius-sm)] text-[var(--brand-text)] t-caption-sm',
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function inlineMarkdownToHtml(
  raw: string,
  classes: Partial<InlineMarkdownClasses> = {},
): string {
  const merged = { ...DEFAULT_CLASSES, ...classes };
  const strippedLinks = raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '');

  const escaped = escapeHtml(strippedLinks);

  return escaped
    .replace(/\*\*(.+?)\*\*/g, `<b class="${merged.bold}">$1</b>`)
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, `<em class="${merged.em}">$1</em>`)
    .replace(/`([^`]+)`/g, `<code class="${merged.code}">$1</code>`);
}
