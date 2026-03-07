import fs from 'fs';
import path from 'path';
import { getWorkspace, type KeywordStrategy } from './workspaces';
import { getUploadRoot } from './data-dir.js';

/**
 * Shared SEO context builder for all AI-powered endpoints.
 * Ensures every AI prompt gets consistent strategy + business context.
 */

export interface SeoContext {
  /** Keyword strategy block for AI prompts */
  keywordBlock: string;
  /** Brand voice block for AI prompts */
  brandVoiceBlock: string;
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
  const empty: SeoContext = { keywordBlock: '', brandVoiceBlock: '', businessContext: '', strategy: undefined };
  if (!workspaceId) return empty;

  const ws = getWorkspace(workspaceId);
  if (!ws) return empty;

  const strategy = ws.keywordStrategy;

  // --- Brand voice ---
  let brandVoiceBlock = '';
  const voiceParts: string[] = [];
  if (ws.brandVoice) voiceParts.push(ws.brandVoice);
  // Read any .txt/.md files from workspace brand-docs folder
  const brandDocsContent = readBrandDocs(ws.folder);
  if (brandDocsContent) voiceParts.push(brandDocsContent);
  if (voiceParts.length > 0) {
    brandVoiceBlock = `\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\n${voiceParts.join('\n\n')}`;
  }

  if (!strategy) return { keywordBlock: '', brandVoiceBlock, businessContext: '', strategy: undefined };

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
      if (pageKw.searchIntent) {
        keywordBlock += `\nSearch intent: ${pageKw.searchIntent}`;
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

  return { keywordBlock, brandVoiceBlock, businessContext, strategy };
}

/**
 * Read .txt and .md files from a workspace's brand-docs/ folder.
 * Returns concatenated content (truncated to ~4000 chars to fit in prompts).
 */
function readBrandDocs(workspaceFolder: string): string {
  const brandDir = path.join(getUploadRoot(), workspaceFolder, 'brand-docs');

  if (!fs.existsSync(brandDir)) return '';

  try {
    const files = fs.readdirSync(brandDir).filter(f => /\.(txt|md)$/i.test(f)).sort();
    if (files.length === 0) return '';

    let content = '';
    for (const file of files) {
      const text = fs.readFileSync(path.join(brandDir, file), 'utf-8').trim();
      if (text) {
        content += `--- ${file} ---\n${text}\n\n`;
      }
      if (content.length > 4000) break;
    }
    return content.slice(0, 4000);
  } catch {
    return '';
  }
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
