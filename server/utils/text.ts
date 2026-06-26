/** Decode common HTML entities to their plain-text equivalents. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Sanitize a string field: trim, limit length, strip control characters. */
export function sanitizeString(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

const INTERNAL_ERROR_PATTERNS = [
  /SQLITE_/i,
  /ENOENT/,
  /at\s+\S+:\d+/,
  /\bdatabase\b/i,
  /prepared statement/i,
  /constraint failed/i,
  /no such (table|column)/i,
];

/** Return the error message if safe to expose to the client, otherwise the generic fallback. */
export function sanitizeErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  if (err.message.length > 200) return fallback;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code.startsWith('SQLITE_')) return fallback;
  if (INTERNAL_ERROR_PATTERNS.some((re) => re.test(err.message))) return fallback;
  return err.message;
}

/** Wrap untrusted text before injecting into an LLM prompt. */
export function sanitizeForPromptInjection(untrusted: string): string {
  const cleaned = untrusted
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/<\|[^|]*\|>/g, '[removed-control-token]')
    .replace(/<\/?untrusted_user_content>/gi, (tag) =>
      tag.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    );
  return `<untrusted_user_content>\n${cleaned}\n</untrusted_user_content>`;
}

/** Sanitize short trusted-field values before inline interpolation into prompt instructions. */
export function sanitizeInlinePromptText(value: unknown, maxLen = 200): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .replace(/<\|[^|]*\|>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/** Sanitize a user-sourced query string for safe inline embedding as a prompt list item. */
export function sanitizeQueryForPrompt(q: string, maxLen = 150): string {
  return q
    .replace(/[\r\n]/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/<\|[^|]*\|>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Extract readable text from an HTML document.
 * NOTE: Not safe for untrusted external HTML. Use only on internal Webflow-fetched pages.
 */
export function stripHtmlToText(
  html: string,
  opts?: { maxLength?: number; stripHeader?: boolean },
): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  let cleaned = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');
  if (opts?.stripHeader) {
    cleaned = cleaned.replace(/<header[\s\S]*?<\/header>/gi, '');
  }
  cleaned = cleaned
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return opts?.maxLength ? cleaned.slice(0, opts.maxLength) : cleaned;
}

/** Strip Markdown code fences from AI responses. */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!/^```(?:json|html|xml)?\s*/i.test(trimmed)) return trimmed;
  return trimmed
    .replace(/^```(?:json|html|xml)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');
}

/** Canonical server-side slugify. */
export function slugify(value: string, opts?: { keepWhitespace?: boolean }): string {
  const keepWs = opts?.keepWhitespace ?? false;
  let s = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, keepWs ? ' ' : '-')
    .replace(/\s+/g, keepWs ? ' ' : '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (keepWs) s = s.trim();
  return s;
}
