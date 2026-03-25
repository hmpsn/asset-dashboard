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
  /** Audience personas block for AI prompts */
  personasBlock: string;
  /** Knowledge base block for AI prompts */
  knowledgeBlock: string;
  /** All context blocks joined — drop this into any prompt for full business awareness */
  fullContext: string;
  /** Full strategy object (for direct access if needed) */
  strategy: KeywordStrategy | undefined;
}

/**
 * Build SEO context from a workspace's keyword strategy.
 * @param workspaceId - workspace to look up
 * @param pagePath - optional page path to find page-specific keywords
 */
export function buildSeoContext(workspaceId?: string, pagePath?: string): SeoContext {
  const empty: SeoContext = { keywordBlock: '', brandVoiceBlock: '', businessContext: '', personasBlock: '', knowledgeBlock: '', fullContext: '', strategy: undefined };
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

  // Build personas + knowledge base (always, even without strategy)
  const personasBlock = buildPersonasContext(workspaceId);
  const knowledgeBlock = buildKnowledgeBase(workspaceId);

  if (!strategy) {
    const fullContext = [brandVoiceBlock, personasBlock, knowledgeBlock].filter(Boolean).join('');
    return { keywordBlock: '', brandVoiceBlock, businessContext: '', personasBlock, knowledgeBlock, fullContext, strategy: undefined };
  }

  let keywordBlock = '';

  // Site-level keywords
  const siteKw = strategy.siteKeywords?.slice(0, 8).join(', ');
  if (siteKw) keywordBlock += `Site target keywords: ${siteKw}`;

  // Business context (general — placed BEFORE page-specific so page keywords take priority)
  const businessContext = strategy.businessContext || '';
  if (businessContext) {
    keywordBlock += `\nGeneral business context: ${businessContext}`;
  }

  // Page-specific keywords (if pagePath provided) — these OVERRIDE general context
  if (pagePath && strategy.pageMap?.length) {
    const pageKw = strategy.pageMap.find(
      p => p.pagePath === pagePath || pagePath.includes(p.pagePath) || p.pagePath.includes(pagePath)
    );
    if (pageKw) {
      keywordBlock += `\n\nTHIS PAGE'S TARGET (overrides general context):`;
      keywordBlock += `\nPrimary keyword: "${pageKw.primaryKeyword}"`;
      if (pageKw.secondaryKeywords?.length) {
        keywordBlock += `\nSecondary keywords: ${pageKw.secondaryKeywords.join(', ')}`;
      }
      if (pageKw.searchIntent) {
        keywordBlock += `\nSearch intent: ${pageKw.searchIntent}`;
      }
      keywordBlock += `\nIMPORTANT: If this page's keywords reference a specific location (city, state, region), ALWAYS use THAT location. Do NOT substitute the business headquarters or a different location from the general business context. The page-level keyword is the authoritative signal for what this page targets.`;
    }
  }

  if (keywordBlock) {
    keywordBlock = `\n\nKEYWORD STRATEGY (incorporate these naturally):\n${keywordBlock}`;
  }

  const fullContext = [keywordBlock, brandVoiceBlock, personasBlock, knowledgeBlock].filter(Boolean).join('');
  return { keywordBlock, brandVoiceBlock, businessContext, personasBlock, knowledgeBlock, fullContext, strategy };
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
 * Build a global knowledge base block for AI chatbot prompts.
 * Combines the workspace's knowledgeBase field + any .txt/.md files in knowledge-docs/.
 */
export function buildKnowledgeBase(workspaceId?: string): string {
  if (!workspaceId) return '';
  const ws = getWorkspace(workspaceId);
  if (!ws) return '';

  const parts: string[] = [];

  // Inline knowledge base field
  if (ws.knowledgeBase?.trim()) {
    parts.push(ws.knowledgeBase.trim());
  }

  // Read knowledge-docs/ folder
  const docsContent = readKnowledgeDocs(ws.folder);
  if (docsContent) parts.push(docsContent);

  if (parts.length === 0) return '';
  return `\n\nBUSINESS KNOWLEDGE BASE (use this to give informed, business-aware answers):\n${parts.join('\n\n')}`;
}

/**
 * Read .txt and .md files from a workspace's knowledge-docs/ folder.
 */
function readKnowledgeDocs(workspaceFolder: string): string {
  const docsDir = path.join(getUploadRoot(), workspaceFolder, 'knowledge-docs');
  if (!fs.existsSync(docsDir)) return '';

  try {
    const files = fs.readdirSync(docsDir).filter(f => /\.(txt|md)$/i.test(f)).sort();
    if (files.length === 0) return '';

    let content = '';
    for (const file of files) {
      const text = fs.readFileSync(path.join(docsDir, file), 'utf-8').trim();
      if (text) {
        content += `--- ${file} ---\n${text}\n\n`;
      }
      if (content.length > 6000) break;
    }
    return content.slice(0, 6000);
  } catch {
    return '';
  }
}

/**
 * Shared instruction block for AI chat prompts — teaches the model to emit
 * rich fenced code blocks that the frontend renders as interactive components.
 */
export const RICH_BLOCKS_PROMPT = `
RICH RESPONSE BLOCKS — You can embed interactive visualizations in your responses using special fenced code blocks. Use them when they make data clearer, but don't force them — plain markdown is fine for simple answers.

\`\`\`metric
(single or array) {"label":"Total Clicks","value":1234,"change":12.5,"changeLabel":"vs last period","format":"number"}
Formats: "number" (default), "percent", "currency". "change" is a % delta (positive = green, negative = red).
For multiple metrics side by side, use an array: [{"label":"Clicks","value":1234},{"label":"CTR","value":3.2,"format":"percent"}]
\`\`\`

\`\`\`chart
{"type":"bar","title":"Top Pages by Clicks","data":[{"label":"/homepage","value":450},{"label":"/about","value":320}]}
Horizontal bar chart. Keep to 3-8 items. Use "valueFormat":"percent" if showing percentages.
\`\`\`

\`\`\`datatable
{"title":"Keyword Performance","headers":["Keyword","Clicks","Impressions","CTR"],"rows":[["seo agency",120,3400,"3.5%"],["web design",85,2100,"4.0%"]],"footer":"Showing top 5 of 48 keywords"}
Table with copy-to-CSV and download buttons. Use for detailed comparisons. Keep rows ≤ 10.
\`\`\`

RULES FOR RICH BLOCKS:
- The JSON must be valid and on a single logical block (newlines are fine inside the fenced block)
- Use rich blocks for: metric summaries, top-N comparisons, detailed breakdowns
- Do NOT use rich blocks for: simple yes/no answers, short explanations, or when you only have 1-2 data points
- You can mix rich blocks with normal markdown in the same response
- Always provide text context around blocks explaining what the data means
`;

/**
 * Build an audience personas block for AI prompts.
 * Returns structured persona data including pain points, goals, and objections.
 */
export function buildPersonasContext(workspaceId?: string): string {
  if (!workspaceId) return '';
  const ws = getWorkspace(workspaceId);
  if (!ws?.personas?.length) return '';

  const personaStr = ws.personas.map(p => {
    const parts = [`**${p.name}**${p.buyingStage ? ` (${p.buyingStage} stage)` : ''}: ${p.description}`];
    if (p.painPoints.length) parts.push(`  Pain points: ${p.painPoints.join('; ')}`);
    if (p.goals.length) parts.push(`  Goals: ${p.goals.join('; ')}`);
    if (p.objections.length) parts.push(`  Objections: ${p.objections.join('; ')}`);
    if (p.preferredContentFormat) parts.push(`  Prefers: ${p.preferredContentFormat}`);
    return parts.join('\n');
  }).join('\n\n');

  return `\n\nTARGET AUDIENCE PERSONAS (write to address these specific people — their pain points, goals, and objections):\n${personaStr}`;
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
