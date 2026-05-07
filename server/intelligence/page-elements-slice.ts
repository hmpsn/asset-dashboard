import type { PageElementSlice } from '../../shared/types/intelligence.js';
import { createLogger } from '../logger.js';
import { getPageElements } from '../page-elements-store.js';

const log = createLogger('workspace-intelligence/page-elements');

export async function assemblePageElements(
  workspaceId: string,
  pagePath: string,
): Promise<PageElementSlice | undefined> {
  try {
    const record = getPageElements(workspaceId, pagePath);
    if (!record) {
      // No persisted catalog: extraction happens during the next generator pass.
      // Returning undefined here keeps intelligence assembly read-only.
      return undefined;
    }
    return {
      pagePath: record.pagePath,
      catalog: record.catalog,
    };
  } catch (err) { // catch-ok: graceful degrade - slice stays undefined
    log.warn({ err, workspaceId, pagePath }, 'assemblePageElements: store read failed, slice unavailable');
    return undefined;
  }
}

export function formatPageElementsSection(slice: PageElementSlice | undefined): string {
  if (!slice) return '';
  const c = slice.catalog;
  const summary: string[] = [];
  if (c.videos.length > 0) summary.push(`${c.videos.length} video${c.videos.length === 1 ? '' : 's'}`);
  const howToCount = c.lists.filter(l => l.isHowToLike).length;
  if (howToCount > 0) summary.push(`${howToCount} HowTo list${howToCount === 1 ? '' : 's'}`);
  if (c.citations.length > 0) summary.push(`${c.citations.length} citation${c.citations.length === 1 ? '' : 's'}`);
  if (c.tables.length > 0) summary.push(`${c.tables.length} table${c.tables.length === 1 ? '' : 's'}`);
  if (c.images.length > 0) summary.push(`${c.images.length} image${c.images.length === 1 ? '' : 's'}`);
  if (c.testimonials.length > 0) summary.push(`${c.testimonials.length} testimonial${c.testimonials.length === 1 ? '' : 's'}`);
  if (c.headings.length > 0) summary.push(`${c.headings.length} heading${c.headings.length === 1 ? '' : 's'}`);
  if (c.codeBlocks.length > 0) summary.push(`${c.codeBlocks.length} code block${c.codeBlocks.length === 1 ? '' : 's'}`);
  if (summary.length === 0) return '';
  // No leading/trailing newlines: formatForPrompt joins all sections with
  // '\n\n', so each formatter must return a string starting at '## ...' and
  // ending without a trailing newline. Matches every other format*Section.
  return `## Page elements (${slice.pagePath})\n${summary.join(' · ')}`;
}
