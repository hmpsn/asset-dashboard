import { getWorkspace, type KeywordStrategy } from './workspaces';

/**
 * Shared SEO context builder for all AI-powered endpoints.
 * Ensures every AI prompt gets consistent strategy + business context.
 */

export interface SeoContext {
  /** Keyword strategy block for AI prompts */
  keywordBlock: string;
  /** Business context string (industry, location, services) */
  businessContext: string;
  /** Full strategy object (for direct access if needed) */
  strategy: KeywordStrategy | undefined;
}

/**
 * Build SEO context from a workspace's keyword strategy.
 * @param workspaceId - workspace to look up
 * @param pagePath - optional page path to find page-specific keywords
 */
export function buildSeoContext(workspaceId?: string, pagePath?: string): SeoContext {
  const empty: SeoContext = { keywordBlock: '', businessContext: '', strategy: undefined };
  if (!workspaceId) return empty;

  const ws = getWorkspace(workspaceId);
  if (!ws) return empty;

  const strategy = ws.keywordStrategy;
  if (!strategy) return empty;

  let keywordBlock = '';

  // Site-level keywords
  const siteKw = strategy.siteKeywords?.slice(0, 8).join(', ');
  if (siteKw) keywordBlock += `Site target keywords: ${siteKw}`;

  // Page-specific keywords (if pagePath provided)
  if (pagePath && strategy.pageMap?.length) {
    const pageKw = strategy.pageMap.find(
      p => p.pagePath === pagePath || pagePath.includes(p.pagePath) || p.pagePath.includes(pagePath)
    );
    if (pageKw) {
      keywordBlock += `\nThis page's primary keyword: "${pageKw.primaryKeyword}"`;
      if (pageKw.secondaryKeywords?.length) {
        keywordBlock += `\nSecondary keywords: ${pageKw.secondaryKeywords.join(', ')}`;
      }
    }
  }

  // Business context
  const businessContext = strategy.businessContext || '';
  if (businessContext) {
    keywordBlock += `\nBusiness context: ${businessContext}`;
  }

  if (keywordBlock) {
    keywordBlock = `\n\nKEYWORD STRATEGY (incorporate these naturally):\n${keywordBlock}`;
  }

  return { keywordBlock, businessContext, strategy };
}

/**
 * Build a full keyword map string for prompts that need cross-page awareness
 * (e.g., internal links, content briefs to avoid cannibalization).
 */
export function buildKeywordMapContext(workspaceId?: string): string {
  if (!workspaceId) return '';
  const ws = getWorkspace(workspaceId);
  const pageMap = ws?.keywordStrategy?.pageMap;
  if (!pageMap?.length) return '';

  const mapStr = pageMap.map(
    p => `${p.pagePath}: "${p.primaryKeyword}"${p.secondaryKeywords?.length ? ` (also: ${p.secondaryKeywords.slice(0, 3).join(', ')})` : ''}`
  ).join('\n');

  return `\n\nEXISTING KEYWORD MAP (avoid cannibalization, suggest internal links where relevant):\n${mapStr}`;
}
