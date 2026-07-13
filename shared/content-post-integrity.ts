export interface ContentPostIntegrityShape {
  status: string;
  introduction: string;
  conclusion: string;
  sections: Array<{ status: string; content: string }>;
}

/** Canonical visible-text projection for generated rich-text completeness checks. */
export function visibleTextFromHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#160|#xA0);/gi, ' ')
    .replace(/&(?:[a-z][a-z0-9]+|#\d+|#x[\da-f]+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countVisibleHtmlWords(html: string): number {
  const visibleText = visibleTextFromHtml(html);
  return visibleText ? visibleText.split(/\s+/).length : 0;
}

export function hasVisibleHtmlContent(html: string): boolean {
  return countVisibleHtmlWords(html) > 0;
}

export function isDeliverableContentPost(post: ContentPostIntegrityShape): boolean {
  return ['draft', 'review', 'approved'].includes(post.status)
    && hasVisibleHtmlContent(post.introduction)
    && hasVisibleHtmlContent(post.conclusion)
    && post.sections.length > 0
    && post.sections.every(section => section.status === 'done' && hasVisibleHtmlContent(section.content));
}
