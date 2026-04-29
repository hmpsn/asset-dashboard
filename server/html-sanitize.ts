import sanitizeHtml from 'sanitize-html';

const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 's', 'u', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
  },
  disallowedTagsMode: 'discard',
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, RICH_TEXT_OPTIONS);
}

export function sanitizePlainText(s: string): string {
  return sanitizeHtml(s, { allowedTags: [], allowedAttributes: {} });
}
