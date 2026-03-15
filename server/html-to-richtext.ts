/**
 * HTML → Webflow Rich Text converter.
 *
 * The Webflow v2 CMS API accepts raw HTML strings for RichText fields,
 * so the primary converter simply assembles post HTML into a single string.
 * If the API ever requires the Webflow node format, the `htmlToWebflowNodes`
 * fallback is provided (transforms common HTML tags into Webflow's JSON structure).
 */

import type { GeneratedPost } from '../shared/types/content.ts';

/**
 * Assemble a GeneratedPost into a single HTML string suitable for a
 * Webflow CMS RichText field. The v2 API accepts raw HTML.
 */
export function assemblePostHtml(post: GeneratedPost): string {
  const parts: string[] = [];

  if (post.introduction) {
    parts.push(post.introduction);
  }

  for (const section of post.sections) {
    if (section.content) {
      parts.push(section.content);
    }
  }

  if (post.conclusion) {
    parts.push(post.conclusion);
  }

  return parts.join('\n');
}

/**
 * Generate a URL-safe slug from a title string.
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}
