import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  prepareBriefContextInputSchema,
  saveBriefInputSchema,
  type PrepareBriefContextInput,
  type SaveBriefInput,
} from '../shared/types/mcp-action-schemas.js';

type PageType = NonNullable<SaveBriefInput['content']['pageType']>;
type BriefContent = SaveBriefInput['content'];

const PAGE_TYPES = ['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource'] as const;
const PERSISTENCE_FLAGS = new Set(['--save', '--send', '--persist', '--save-brief', '--send-to-client']);
const CONVERSION_PAGE_TYPES = new Set<PageType>(['landing', 'service', 'location', 'product']);

const pageTypeSchema = z.enum(PAGE_TYPES);
const batchCaseConfigSchema = z.object({
  id: z.string().trim().min(1).optional(),
  workspaceId: z.string().trim().min(1).optional(),
  workspace_id: z.string().trim().min(1).optional(),
  topic: z.string().trim().min(1),
  pageType: pageTypeSchema.optional(),
  page_type: pageTypeSchema.optional(),
  variants: z.array(z.string().trim().min(1)).optional(),
  includePosts: z.boolean().optional(),
  include_posts: z.boolean().optional(),
}).transform((value): BatchCaseConfig => {
  const workspaceId = value.workspaceId ?? value.workspace_id;
  const pageType = value.pageType ?? value.page_type;
  if (!workspaceId) throw new Error('Batch experiment is missing workspaceId.');
  if (!pageType) throw new Error('Batch experiment is missing pageType.');
  return {
    id: value.id,
    workspaceId,
    topic: value.topic,
    pageType,
    variants: value.variants,
    includePosts: value.includePosts ?? value.include_posts,
  };
});
const batchConfigSchema = z.object({
  experiments: z.array(batchCaseConfigSchema).min(1),
  variants: z.array(z.string().trim().min(1)).optional(),
  includePosts: z.boolean().optional(),
  include_posts: z.boolean().optional(),
}).transform((value): BatchConfig => ({
  experiments: value.experiments,
  variants: value.variants,
  includePosts: value.includePosts ?? value.include_posts,
}));

interface VariantConfig {
  id: string;
  label: string;
  temperature: number;
  instructions: string;
}

const VARIANTS: Record<string, VariantConfig> = {
  current: {
    id: 'current',
    label: 'Current Contract',
    temperature: 0.5,
    instructions: `Use the current platform intent: factual, brand-aware, SEO-informed, and right-sized for the page type. Do not add extra sections just because more context is available.`,
  },
  concise: {
    id: 'concise',
    label: 'Concise Outline',
    temperature: 0.45,
    instructions: `Bias toward fewer sections, fewer subheadings, and tighter notes. Preserve search intent and factual safety, but remove article-style expansion from conversion pages.`,
  },
  'conversion-dense': {
    id: 'conversion-dense',
    label: 'Conversion Dense',
    temperature: 0.55,
    instructions: `Prioritize buyer decision flow: problem, fit, proof, process, objections, and one clear next step. Keep brand voice present but compact.`,
  },
  blended: {
    id: 'blended',
    label: 'Blended Candidate',
    temperature: 0.5,
    instructions: `Blend the current contract's factual and brand discipline with the concise variant's compressed outline shape. Add light buyer-flow guidance, but avoid duplicate CTAs, sales repetition, and blog-style teaching sprawl.`,
  },
};

interface ExperimentCliOptions {
  workspaceId: string;
  topic: string;
  pageType: PageType;
  mcpUrl: string;
  variants: string[];
  includePosts: boolean;
  model: string;
  maxTokens: number;
  outDir: string;
}

interface BatchCaseConfig {
  id?: string;
  workspaceId: string;
  topic: string;
  pageType: PageType;
  variants?: string[];
  includePosts?: boolean;
}

interface BatchCliOptions {
  batchFile: string;
  mcpUrl: string;
  variants: string[];
  includePosts: boolean;
  model: string;
  maxTokens: number;
  outDir: string;
}

interface BatchConfig {
  experiments: BatchCaseConfig[];
  variants?: string[];
  includePosts?: boolean;
}

interface McpTextContent {
  type: 'text';
  text: string;
}

interface McpToolResult {
  content?: McpTextContent[];
  isError?: boolean;
}

interface PrepareBriefContextPayload {
  brief_request_handle: string;
  topic: string;
  layout: PrepareBriefContextInput['layout'];
  layout_schema: unknown;
  brief_schema: unknown;
  prompt_context: string;
  dashboard_url: string;
}

interface BriefMetric {
  label: string;
  value: string | number;
  ok: boolean;
}

interface BriefScore {
  variant: string;
  score: number;
  metrics: BriefMetric[];
  warnings: string[];
}

interface DraftScore {
  variant: string;
  score: number;
  metrics: BriefMetric[];
  warnings: string[];
  observations: string[];
}

interface DraftResult {
  html: string;
  score: DraftScore;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
}

interface VariantResult {
  variant: VariantConfig;
  prompt: string;
  brief: BriefContent;
  score: BriefScore;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  draft?: DraftResult;
}

interface ExperimentReport {
  workspaceId: string;
  topic: string;
  pageType: PageType;
  mcpUrl: string;
  generatedAt: string;
  dashboardUrl?: string;
  results: VariantResult[];
}

interface BatchCaseReport {
  id: string;
  outDir: string;
  report: ExperimentReport;
}

interface BatchExperimentReport {
  generatedAt: string;
  batchFile: string;
  mcpUrl: string;
  cases: BatchCaseReport[];
}

const PAGE_BUDGETS: Record<PageType, {
  minWords: number;
  maxWords: number;
  targetWords: number;
  minSections: number;
  maxSections: number;
  maxSubheadings: number;
}> = {
  blog: { minWords: 1400, maxWords: 2600, targetWords: 1800, minSections: 5, maxSections: 9, maxSubheadings: 4 },
  pillar: { minWords: 1800, maxWords: 3200, targetWords: 2400, minSections: 6, maxSections: 10, maxSubheadings: 4 },
  resource: { minWords: 1300, maxWords: 2400, targetWords: 1800, minSections: 5, maxSections: 8, maxSubheadings: 4 },
  service: { minWords: 800, maxWords: 1100, targetWords: 1000, minSections: 4, maxSections: 5, maxSubheadings: 2 },
  location: { minWords: 700, maxWords: 1000, targetWords: 900, minSections: 4, maxSections: 5, maxSubheadings: 2 },
  landing: { minWords: 800, maxWords: 1200, targetWords: 900, minSections: 4, maxSections: 5, maxSubheadings: 2 },
  product: { minWords: 600, maxWords: 1000, targetWords: 750, minSections: 4, maxSections: 5, maxSubheadings: 2 },
};

const CTA_HEADING_PATTERN = /\b(book|schedule|get started|contact|discovery|next step|start here|ready|call|consultation)\b/i;
const LOCAL_SEO_OPERATIONS_PATTERN = /\b(NAP consistency|Google Business Profile|GBP\b|directory listings?|citation cleanup|schema markup|structured data|local SEO mechanics|search profile|on-page schema|directories)\b/i;
const SOURCE_META_COMMENTARY_PATTERN = /\b(provided context|business knowledge base|provided business information|source material|the brief|the context confirms|based on the information provided)\b/i;
const HARD_CLAIM_PATTERN = /\b(?:guaranteed?|guarantees?|best|#1|number one|lowest|cheapest|always|never|every patient|all patients)\b/i;
const PRICE_OR_STAT_PATTERN = /(?:\$[\d,]+|\b\d+(?:\.\d+)?\s?%|\b\d+\s?(?:x|times)\b)/i;

function usage(): string {
  return `Usage:
  MCP_API_KEY=... OPENAI_API_KEY=... npx tsx scripts/experiment-content-generation.ts \\
    --workspace <workspace_id> \\
    --topic "Dental insurance and financing in Sarasota" \\
    --page-type service \\
    [--mcp-url http://localhost:3000/mcp] \\
    [--variants current,concise,blended] \\
    [--include-posts]

Batch mode:
  MCP_API_KEY=... OPENAI_API_KEY=... npx tsx scripts/experiment-content-generation.ts \\
    --batch-file content-experiments.batch.json \\
    --include-posts \\
    [--variants current,concise,blended]

This harness is intentionally read-only. It calls prepare_brief_context, generates local candidates, and writes local artifacts only.`;
}

function stripJsonCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!/^```(?:json)?\s*/i.test(trimmed)) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');
}

export function parseExperimentArgs(argv: string[]): ExperimentCliOptions {
  const values = parseCliValues(argv);
  if (values.has('--batch-file')) {
    throw new Error('Use parseBatchExperimentArgs for --batch-file mode.');
  }

  const workspaceId = values.get('--workspace') ?? values.get('--workspace-id');
  const topic = values.get('--topic');
  const rawPageType = values.get('--page-type');

  if (!workspaceId || !topic || !rawPageType) {
    throw new Error(`Missing required arguments.\n\n${usage()}`);
  }

  const variants = parseVariantList(values.get('--variants') ?? 'current,concise,blended');

  return {
    workspaceId,
    topic,
    pageType: pageTypeSchema.parse(rawPageType),
    variants,
    includePosts: values.has('--include-posts') || values.has('--quality-audit'),
    mcpUrl: values.get('--mcp-url') ?? process.env.MCP_URL ?? 'http://localhost:3001/mcp',
    model: values.get('--model') ?? 'gpt-5.4',
    maxTokens: Number(values.get('--max-tokens') ?? 5000),
    outDir: values.get('--out-dir') ?? path.join('artifacts', 'content-experiments', `${new Date().toISOString().replace(/[:.]/g, '-')}-${slugify(topic)}`),
  };
}

export function parseBatchExperimentArgs(argv: string[]): BatchCliOptions {
  const values = parseCliValues(argv);
  const batchFile = values.get('--batch-file');
  if (!batchFile) {
    throw new Error(`Missing --batch-file.\n\n${usage()}`);
  }

  return {
    batchFile,
    variants: parseVariantList(values.get('--variants') ?? 'current,concise,blended'),
    includePosts: values.has('--include-posts') || values.has('--quality-audit'),
    mcpUrl: values.get('--mcp-url') ?? process.env.MCP_URL ?? 'http://localhost:3001/mcp',
    model: values.get('--model') ?? 'gpt-5.4',
    maxTokens: Number(values.get('--max-tokens') ?? 5000),
    outDir: values.get('--out-dir') ?? path.join('artifacts', 'content-experiments', `batch-${new Date().toISOString().replace(/[:.]/g, '-')}`),
  };
}

function parseCliValues(argv: string[]): Map<string, string> {
  for (const flag of argv) {
    if (PERSISTENCE_FLAGS.has(flag)) {
      throw new Error(`Persistence is intentionally unsupported in this read-only experiment harness: ${flag}`);
    }
  }

  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      values.set(token, 'true');
      continue;
    }
    values.set(token, next);
    index += 1;
  }

  return values;
}

function parseVariantList(raw: string): string[] {
  const variants = raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  if (variants.length === 0) {
    throw new Error('At least one variant is required.');
  }

  const unknownVariants = variants.filter(variant => !VARIANTS[variant]);
  if (unknownVariants.length > 0) {
    throw new Error(`Unknown variant(s): ${unknownVariants.join(', ')}. Available: ${Object.keys(VARIANTS).join(', ')}`);
  }

  return variants;
}

export function buildExperimentLayout(topic: string, pageType: PageType): PrepareBriefContextInput['layout'] {
  const conversionPage = ['landing', 'service', 'location', 'product'].includes(pageType);
  const sections = conversionPage
    ? [
        { heading: { level: 1 as const, text: topic }, description: `Conversion page outline for ${topic}` },
        { heading: { level: 2 as const, text: 'Core offer and fit' }, description: 'Clarify who this is for and why it matters.' },
        { heading: { level: 2 as const, text: 'Proof and decision support' }, description: 'Use only available proof and concrete differentiators.' },
        { heading: { level: 2 as const, text: 'Process or options' }, description: 'Make the path forward easy to understand.' },
        { heading: { level: 2 as const, text: 'Next step' }, description: 'One concise closing CTA.', callout: 'cta' as const },
      ]
    : [
        { heading: { level: 1 as const, text: topic }, description: `Educational outline for ${topic}` },
        { heading: { level: 2 as const, text: 'Quick answer' }, description: 'Answer the search intent directly.' },
        { heading: { level: 2 as const, text: 'Core guidance' }, description: 'Build useful depth with examples.' },
        { heading: { level: 2 as const, text: 'Common questions' }, description: 'Cover related questions without padding.' },
        { heading: { level: 2 as const, text: 'Next step' }, description: 'One restrained close.', callout: 'cta' as const },
      ];

  return {
    type: 'outline',
    structure: { sections },
  };
}

export function buildBriefExperimentPrompt(args: {
  topic: string;
  pageType: PageType;
  variant: VariantConfig;
  promptContext: string;
  layout: PrepareBriefContextInput['layout'];
}): string {
  const budget = PAGE_BUDGETS[args.pageType];
  const subheadingRule = ['service', 'location', 'landing', 'product'].includes(args.pageType)
    ? 'Subheadings are optional. Use 0-2 only where they materially improve scanning; do not force H3s into CTA, proof, contact, or short conversion sections.'
    : 'Use subheadings where they improve educational depth and scanning.';

  return `You are generating a local experiment candidate for a content brief. This is not a save action.

TOPIC:
${args.topic}

PAGE TYPE:
${args.pageType}

VARIANT:
${args.variant.label}
${args.variant.instructions}

LIVE PLATFORM CONTEXT FROM MCP:
${args.promptContext}

REQUESTED LAYOUT:
${JSON.stringify(args.layout, null, 2)}

RIGHT-SIZED BRIEF CONTRACT:
- Target ${budget.targetWords} words, acceptable range ${budget.minWords}-${budget.maxWords}.
- Use ${budget.minSections}-${budget.maxSections} useful H2 sections.
- ${subheadingRule}
- Factual safety and output format are mandatory.
- Page type, conversion goal, and word budget outrank brand voice/style.
- Use brand context to choose wording, proof, and positioning; do not expand the outline because more brand context is available.
- Service/location/landing/product pages should not read like long SEO articles.
- Location pages must not teach local SEO operations to the reader. Do not include NAP consistency, directory listings, Google Business Profile upkeep, or schema/structured-data mechanics as public-facing advice.
- Include one closing CTA path only.

Return ONLY valid JSON matching this shape:
{
  "targetKeyword": "...",
  "secondaryKeywords": ["..."],
  "suggestedTitle": "...",
  "suggestedMetaDesc": "...",
  "outline": [
    { "heading": "...", "subheadings": ["..."], "notes": "...", "wordCount": 200, "keywords": ["..."] }
  ],
  "wordCountTarget": ${budget.targetWords},
  "intent": "...",
  "audience": "...",
  "competitorInsights": "...",
  "internalLinkSuggestions": ["..."],
  "pageType": "${args.pageType}",
  "executiveSummary": "..."
}`;
}

export function scoreBrief(brief: BriefContent, variant = 'candidate'): BriefScore {
  const pageType = brief.pageType ?? 'blog';
  const budget = PAGE_BUDGETS[pageType];
  const outline = brief.outline ?? [];
  const targetWords = brief.wordCountTarget;
  const outlineWordCount = outline.reduce((sum, section) => sum + (section.wordCount ?? 0), 0);
  const subheadingCount = outline.reduce((sum, section) => sum + (section.subheadings?.length ?? 0), 0);
  const overfullSubheadingSections = outline.filter(section => (section.subheadings?.length ?? 0) > budget.maxSubheadings).length;
  const ctaSectionCount = outline.filter(section => {
    const text = `${section.heading} ${section.notes ?? ''}`;
    return CTA_HEADING_PATTERN.test(text);
  }).length;
  const localSeoOperations = pageType === 'location'
    ? outline.filter(section => LOCAL_SEO_OPERATIONS_PATTERN.test(`${section.heading} ${section.notes ?? ''} ${(section.subheadings ?? []).join(' ')}`)).length
    : 0;

  const requiredFields = [
    brief.targetKeyword,
    brief.suggestedTitle,
    brief.suggestedMetaDesc,
    brief.intent,
    brief.audience,
    brief.competitorInsights,
  ];
  const missingFieldCount = requiredFields.filter(value => !String(value ?? '').trim()).length;

  const warnings: string[] = [];
  let penalty = 0;

  if (targetWords > budget.maxWords) {
    const overagePenalty = Math.min(24, Math.ceil((targetWords - budget.maxWords) / 50) * 2);
    penalty += overagePenalty;
    warnings.push(`Word target is above ${pageType} budget by ${targetWords - budget.maxWords} words.`);
  }
  if (targetWords < budget.minWords) {
    penalty += Math.min(16, Math.ceil((budget.minWords - targetWords) / 50) * 2);
    warnings.push(`Word target is below ${pageType} budget by ${budget.minWords - targetWords} words.`);
  }
  if (outline.length > budget.maxSections) {
    penalty += (outline.length - budget.maxSections) * 6;
    warnings.push(`Outline has ${outline.length} sections; ${pageType} budget allows ${budget.maxSections}.`);
  }
  if (outline.length < budget.minSections) {
    penalty += (budget.minSections - outline.length) * 4;
    warnings.push(`Outline has ${outline.length} sections; ${pageType} budget expects at least ${budget.minSections}.`);
  }
  if (overfullSubheadingSections > 0) {
    penalty += overfullSubheadingSections * 4;
    warnings.push(`${overfullSubheadingSections} section(s) exceed the ${budget.maxSubheadings} subheading cap.`);
  }
  if (ctaSectionCount > 1 && ['service', 'location', 'landing', 'product'].includes(pageType)) {
    penalty += (ctaSectionCount - 1) * 8;
    warnings.push(`Detected ${ctaSectionCount} CTA/contact-like sections; conversion pages should have one close.`);
  }
  if (localSeoOperations > 0) {
    penalty += Math.min(24, localSeoOperations * 12);
    warnings.push('Location outline includes reader-facing local SEO operations language.');
  }
  if (missingFieldCount > 0) {
    penalty += missingFieldCount * 8;
    warnings.push(`${missingFieldCount} required brief field(s) are empty.`);
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  const metrics: BriefMetric[] = [
    { label: 'word target', value: targetWords, ok: targetWords >= budget.minWords && targetWords <= budget.maxWords },
    { label: 'outline words', value: outlineWordCount, ok: outlineWordCount === 0 || outlineWordCount <= budget.maxWords },
    { label: 'section count', value: outline.length, ok: outline.length >= budget.minSections && outline.length <= budget.maxSections },
    { label: 'subheadings', value: subheadingCount, ok: overfullSubheadingSections === 0 },
    { label: 'CTA-like sections', value: ctaSectionCount, ok: ctaSectionCount <= 1 || !['service', 'location', 'landing', 'product'].includes(pageType) },
    { label: 'local SEO ops mentions', value: localSeoOperations, ok: localSeoOperations === 0 },
  ];

  return { variant, score, metrics, warnings };
}

function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function countHtmlWords(html: string): number {
  return countWords(stripHtml(html));
}

function extractTagText(html: string, tagName: string): string[] {
  const matches = [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi'))];
  return matches.map(match => stripHtml(match[1] ?? ''));
}

function findRepeatedPhrases(text: string): string[] {
  const stop = new Set(['that', 'with', 'from', 'this', 'your', 'have', 'will', 'into', 'what', 'when', 'where', 'they', 'them', 'than', 'then', 'care', 'dental']);
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stop.has(word));
  const counts = new Map<string, number>();
  for (let index = 0; index <= words.length - 4; index += 1) {
    const phrase = words.slice(index, index + 4).join(' ');
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([phrase, count]) => `${phrase} (${count}x)`);
}

export function scoreDraft(html: string, brief: BriefContent, variant = 'candidate'): DraftScore {
  const pageType = brief.pageType ?? 'blog';
  const budget = PAGE_BUDGETS[pageType];
  const plain = stripHtml(html);
  const wordCount = countWords(plain);
  const h2Count = extractTagText(html, 'h2').length;
  const h3Count = extractTagText(html, 'h3').length;
  const paragraphWords = extractTagText(html, 'p').map(countWords);
  const longParagraphs = paragraphWords.filter(count => count > 90).length;
  const averageParagraphWords = paragraphWords.length
    ? Math.round(paragraphWords.reduce((sum, count) => sum + count, 0) / paragraphWords.length)
    : 0;
  const ctaHeadings = extractTagText(html, 'h2').filter(heading => CTA_HEADING_PATTERN.test(heading)).length;
  const localSeoOperations = pageType === 'location' ? (LOCAL_SEO_OPERATIONS_PATTERN.test(plain) ? 1 : 0) : 0;
  const sourceMetaCommentary = SOURCE_META_COMMENTARY_PATTERN.test(plain) ? 1 : 0;
  const hardClaims = HARD_CLAIM_PATTERN.test(plain) ? 1 : 0;
  const statOrPriceClaims = PRICE_OR_STAT_PATTERN.test(plain) ? 1 : 0;
  const repeatedPhrases = findRepeatedPhrases(plain);

  const warnings: string[] = [];
  const observations: string[] = [];
  let penalty = 0;

  if (wordCount > Math.round(budget.maxWords * 1.12)) {
    penalty += Math.min(24, Math.ceil((wordCount - budget.maxWords) / 60) * 3);
    warnings.push(`Draft is over the ${pageType} budget by ${wordCount - budget.maxWords} words.`);
  }
  if (wordCount < Math.round(budget.minWords * 0.85)) {
    penalty += Math.min(16, Math.ceil((budget.minWords - wordCount) / 60) * 3);
    warnings.push(`Draft may be too thin for ${pageType} intent.`);
  }
  if (h2Count > budget.maxSections + 1) {
    penalty += (h2Count - budget.maxSections - 1) * 4;
    warnings.push(`Draft has ${h2Count} H2s; expected roughly ${budget.minSections}-${budget.maxSections} plus one close.`);
  }
  if (CONVERSION_PAGE_TYPES.has(pageType) && h3Count > budget.maxSections * budget.maxSubheadings) {
    penalty += 6;
    warnings.push(`Draft uses ${h3Count} H3s; conversion pages should stay lighter.`);
  }
  if (longParagraphs > 0) {
    penalty += Math.min(12, longParagraphs * 3);
    warnings.push(`${longParagraphs} paragraph(s) exceed 90 words.`);
  }
  if (CONVERSION_PAGE_TYPES.has(pageType) && ctaHeadings > 1) {
    penalty += (ctaHeadings - 1) * 8;
    warnings.push(`Detected ${ctaHeadings} CTA-like H2 headings; conversion pages should have one close.`);
  }
  if (localSeoOperations > 0) {
    penalty += 16;
    warnings.push('Draft includes reader-facing local SEO operations language.');
  }
  if (sourceMetaCommentary > 0) {
    penalty += 18;
    warnings.push('Draft exposes internal source/context commentary to the reader.');
  }
  if (hardClaims > 0) {
    penalty += 6;
    warnings.push('Draft includes absolute/hype claim language that may need human review.');
  }
  if (statOrPriceClaims > 0) {
    penalty += 6;
    warnings.push('Draft includes price/stat-style claims that may need source verification.');
  }
  if (repeatedPhrases.length > 0) {
    penalty += Math.min(12, repeatedPhrases.length * 3);
    warnings.push(`Repeated phrase clusters detected: ${repeatedPhrases.join(', ')}.`);
  }

  if (averageParagraphWords > 0) observations.push(`Average paragraph length: ${averageParagraphWords} words.`);
  if (repeatedPhrases.length === 0) observations.push('No high-frequency repeated 4-word phrase clusters detected.');

  const metrics: BriefMetric[] = [
    { label: 'draft words', value: wordCount, ok: wordCount >= Math.round(budget.minWords * 0.85) && wordCount <= Math.round(budget.maxWords * 1.12) },
    { label: 'H2 headings', value: h2Count, ok: h2Count <= budget.maxSections + 1 },
    { label: 'H3 headings', value: h3Count, ok: !CONVERSION_PAGE_TYPES.has(pageType) || h3Count <= budget.maxSections * budget.maxSubheadings },
    { label: 'long paragraphs', value: longParagraphs, ok: longParagraphs === 0 },
    { label: 'CTA-like H2 headings', value: ctaHeadings, ok: ctaHeadings <= 1 || !CONVERSION_PAGE_TYPES.has(pageType) },
    { label: 'local SEO ops mentions', value: localSeoOperations, ok: localSeoOperations === 0 },
    { label: 'source meta-commentary', value: sourceMetaCommentary, ok: sourceMetaCommentary === 0 },
    { label: 'hard claim flags', value: hardClaims + statOrPriceClaims, ok: hardClaims + statOrPriceClaims === 0 },
  ];

  return {
    variant,
    score: Math.max(0, Math.min(100, 100 - penalty)),
    metrics,
    warnings,
    observations,
  };
}

function buildDraftExperimentPrompt(args: {
  topic: string;
  pageType: PageType;
  variant: VariantConfig;
  promptContext: string;
  brief: BriefContent;
}): string {
  const budget = PAGE_BUDGETS[args.pageType];
  const conversionGuidance = CONVERSION_PAGE_TYPES.has(args.pageType)
    ? `- This is a conversion page, not a blog article. Keep it compact, decisive, and easy to scan.
- Use one closing CTA path only.
- Do not add FAQ sections unless the brief explicitly includes them.
- Do not repeat the brand name in every section.`
    : `- This page type allows educational depth, but every section should still earn its place.
- Use examples and practical guidance instead of filler.`;

  return `You are generating a local read-only content-quality experiment draft. This is not a save action.

TOPIC:
${args.topic}

PAGE TYPE:
${args.pageType}

VARIANT:
${args.variant.label}
${args.variant.instructions}

LIVE PLATFORM CONTEXT FROM MCP:
${args.promptContext}

CONTENT BRIEF CANDIDATE:
${JSON.stringify(args.brief, null, 2)}

QUALITY CONTRACT:
- Target ${args.brief.wordCountTarget || budget.targetWords} words; acceptable practical range ${budget.minWords}-${budget.maxWords} for ${args.pageType} pages.
- Factual safety and output format are mandatory.
- Page type, conversion goal, and word budget outrank brand voice/style.
- Use brand context to choose wording, proof, and positioning; do not expand the page because more brand context is available.
${conversionGuidance}
- Keep paragraphs short enough for real readers to scan.
- Avoid invented prices, stats, financing terms, guarantees, timelines, rankings, or awards.
- Do not expose internal sourcing language to readers. Never mention the brief, provided context, source material, business knowledge base, or what the provided information confirms.
- Preserve useful specificity from the brief. Remove generic SEO filler.
- Location pages must not teach local SEO operations to the reader.

Return ONLY clean HTML for the final page draft:
- Include the H1 as <h1>.
- Use <h2>, optional <h3>, <p>, <ul>/<li>, <ol>/<li>, <strong>, and <a>.
- No markdown, no labels, no JSON, no commentary.`;
}

export function formatExperimentReport(report: ExperimentReport): string {
  const rows = report.results
    .map(result => `| ${result.variant.id} | ${result.score.score} | ${result.draft?.score.score ?? 'n/a'} | ${result.brief.wordCountTarget} | ${result.brief.outline.length} | ${result.score.warnings.join('<br>') || result.draft?.score.warnings.join('<br>') || 'None'} |`)
    .join('\n');

  const details = report.results.map(result => {
    const metrics = result.score.metrics
      .map(metric => `- ${metric.ok ? 'OK' : 'Review'} ${metric.label}: ${metric.value}`)
      .join('\n');
    const draftDetails = result.draft
      ? `
Draft quality score: ${result.draft.score.score}
Draft tokens: ${result.draft.tokens.total} total (${result.draft.tokens.prompt} prompt / ${result.draft.tokens.completion} completion)

${result.draft.score.metrics.map(metric => `- ${metric.ok ? 'OK' : 'Review'} ${metric.label}: ${metric.value}`).join('\n')}

Draft warnings:
${result.draft.score.warnings.map(warning => `- ${warning}`).join('\n') || '- None'}

Draft observations:
${result.draft.score.observations.map(observation => `- ${observation}`).join('\n') || '- None'}
`
      : '';
    return `## ${result.variant.label}

Brief score: ${result.score.score}
Brief tokens: ${result.tokens.total} total (${result.tokens.prompt} prompt / ${result.tokens.completion} completion)

${metrics}

Brief warnings:
${result.score.warnings.map(warning => `- ${warning}`).join('\n') || '- None'}
${draftDetails}
`;
  }).join('\n');

  return `# Content Generation Experiment

- Workspace: \`${report.workspaceId}\`
- Topic: ${report.topic}
- Page type: ${report.pageType}
- Generated: ${report.generatedAt}
- MCP URL: ${report.mcpUrl}
${report.dashboardUrl ? `- Dashboard: ${report.dashboardUrl}` : ''}

This is a read-only local experiment. It used MCP context preparation and did not call save or send tools.

| Variant | Brief Score | Draft Score | Word Target | Sections | Warnings |
| --- | ---: | ---: | ---: | ---: | --- |
${rows}

${details}`;
}

async function callMcpTool<TPayload>(
  mcpUrl: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<TPayload> {
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) throw new Error('MCP_API_KEY is required.');

  const baseHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${apiKey}`,
  };

  await fetch(mcpUrl, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'content-experiment-harness', version: '1.0.0' },
      },
      id: 0,
    }),
  });

  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as { result?: McpToolResult; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? 'MCP tool call returned an error.');
  }

  const result = json.result;
  if (!result?.content?.[0]?.text || result.isError) {
    throw new Error(result?.content?.[0]?.text ?? 'MCP tool returned no text content.');
  }

  return JSON.parse(result.content[0].text) as TPayload;
}

async function generateBriefCandidate(args: {
  workspaceId: string;
  model: string;
  maxTokens: number;
  prompt: string;
  variant: VariantConfig;
}): Promise<{ brief: BriefContent; tokens: VariantResult['tokens'] }> {
  const { callAI } = await import('../server/ai.js');
  const result = await callAI({
    feature: 'content-brief-experiment',
    model: args.model,
    messages: [{ role: 'user', content: args.prompt }],
    maxTokens: args.maxTokens,
    temperature: args.variant.temperature,
    responseFormat: { type: 'json_object' },
    researchMode: true,
    workspaceId: args.workspaceId,
  });

  const parsed = JSON.parse(stripJsonCodeFences(result.text).trim());
  const validated = saveBriefInputSchema.shape.content.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`AI returned invalid brief content for ${args.variant.id}: ${validated.error.message}`);
  }
  return {
    brief: validated.data,
    tokens: result.tokens,
  };
}

async function generateDraftCandidate(args: {
  workspaceId: string;
  model: string;
  maxTokens: number;
  prompt: string;
  variant: VariantConfig;
  brief: BriefContent;
}): Promise<DraftResult> {
  const { callAI } = await import('../server/ai.js');
  const result = await callAI({
    feature: 'content-draft-experiment',
    model: args.model,
    messages: [{ role: 'user', content: args.prompt }],
    maxTokens: Math.max(args.maxTokens, 7000),
    temperature: Math.min(0.65, args.variant.temperature + 0.1),
    researchMode: true,
    workspaceId: args.workspaceId,
  });

  const html = result.text.trim();
  return {
    html,
    score: scoreDraft(html, args.brief, args.variant.id),
    tokens: result.tokens,
  };
}

export async function runBriefExperiment(options: ExperimentCliOptions): Promise<ExperimentReport> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for local candidate generation.');
  }

  const layout = buildExperimentLayout(options.topic, options.pageType);
  const prepareArgs = {
    workspace_id: options.workspaceId,
    topic: options.topic,
    layout,
  };
  const parsedArgs = prepareBriefContextInputSchema.safeParse(prepareArgs);
  if (!parsedArgs.success) {
    throw new Error(`Invalid prepare_brief_context payload: ${parsedArgs.error.message}`);
  }

  const context = await callMcpTool<PrepareBriefContextPayload>(
    options.mcpUrl,
    'prepare_brief_context',
    parsedArgs.data,
  );

  const results: VariantResult[] = [];
  for (const variantId of options.variants) {
    const variant = VARIANTS[variantId];
    const prompt = buildBriefExperimentPrompt({
      topic: options.topic,
      pageType: options.pageType,
      variant,
      promptContext: context.prompt_context,
      layout: context.layout,
    });
    const { brief, tokens } = await generateBriefCandidate({
      workspaceId: options.workspaceId,
      model: options.model,
      maxTokens: options.maxTokens,
      prompt,
      variant,
    });
    const draft = options.includePosts
      ? await generateDraftCandidate({
          workspaceId: options.workspaceId,
          model: options.model,
          maxTokens: options.maxTokens,
          prompt: buildDraftExperimentPrompt({
            topic: options.topic,
            pageType: options.pageType,
            variant,
            promptContext: context.prompt_context,
            brief,
          }),
          variant,
          brief,
        })
      : undefined;
    results.push({
      variant,
      prompt,
      brief,
      tokens,
      score: scoreBrief(brief, variant.id),
      draft,
    });
  }

  return {
    workspaceId: options.workspaceId,
    topic: options.topic,
    pageType: options.pageType,
    mcpUrl: options.mcpUrl,
    generatedAt: new Date().toISOString(),
    dashboardUrl: context.dashboard_url,
    results,
  };
}

function resultScore(result: VariantResult): number {
  return result.draft?.score.score ?? result.score.score;
}

function bestVariantForReport(report: ExperimentReport): VariantResult {
  return [...report.results].sort((a, b) => {
    const scoreDelta = resultScore(b) - resultScore(a);
    if (scoreDelta !== 0) return scoreDelta;
    return b.score.score - a.score.score;
  })[0] ?? report.results[0];
}

export function summarizeBatchWinners(batch: BatchExperimentReport): Array<{
  pageType: PageType;
  winner: string;
  averageScore: number;
  cases: number;
}> {
  const grouped = new Map<PageType, Map<string, { total: number; cases: number }>>();
  for (const caseReport of batch.cases) {
    const pageType = caseReport.report.pageType;
    const variantScores = grouped.get(pageType) ?? new Map<string, { total: number; cases: number }>();
    for (const result of caseReport.report.results) {
      const current = variantScores.get(result.variant.id) ?? { total: 0, cases: 0 };
      current.total += resultScore(result);
      current.cases += 1;
      variantScores.set(result.variant.id, current);
    }
    grouped.set(pageType, variantScores);
  }

  return [...grouped.entries()].map(([pageType, variantScores]) => {
    const winner = [...variantScores.entries()]
      .map(([variant, score]) => ({
        variant,
        average: Math.round((score.total / score.cases) * 10) / 10,
        cases: score.cases,
      }))
      .sort((a, b) => b.average - a.average || a.variant.localeCompare(b.variant))[0];
    return {
      pageType,
      winner: winner.variant,
      averageScore: winner.average,
      cases: winner.cases,
    };
  }).sort((a, b) => a.pageType.localeCompare(b.pageType));
}

export function formatBatchReport(batch: BatchExperimentReport): string {
  const caseRows = batch.cases.map((caseReport) => {
    const best = bestVariantForReport(caseReport.report);
    return `| ${caseReport.id} | ${caseReport.report.pageType} | ${caseReport.report.topic} | ${best.variant.id} | ${resultScore(best)} | ${caseReport.outDir}/report.md |`;
  }).join('\n');

  const byPageType = summarizeBatchWinners(batch)
    .map(summary => `| ${summary.pageType} | ${summary.winner} | ${summary.averageScore} | ${summary.cases} |`)
    .join('\n');

  const variantRows = batch.cases.flatMap(caseReport =>
    caseReport.report.results.map(result => `| ${caseReport.id} | ${caseReport.report.pageType} | ${result.variant.id} | ${result.score.score} | ${result.draft?.score.score ?? 'n/a'} | ${resultScore(result)} | ${(result.score.warnings.length + (result.draft?.score.warnings.length ?? 0)) || 0} |`),
  ).join('\n');

  return `# Content Generation Batch Experiment

- Generated: ${batch.generatedAt}
- Batch file: \`${batch.batchFile}\`
- MCP URL: ${batch.mcpUrl}
- Cases: ${batch.cases.length}

This is a read-only local experiment. It used MCP context preparation and did not call save or send tools.

## Recommended Winners By Page Type

| Page Type | Winner | Average Score | Scored Cases |
| --- | --- | ---: | ---: |
${byPageType}

## Case Winners

| Case | Page Type | Topic | Winner | Score | Report |
| --- | --- | --- | --- | ---: | --- |
${caseRows}

## Variant Scores

| Case | Page Type | Variant | Brief Score | Draft Score | Effective Score | Warning Count |
| --- | --- | --- | ---: | ---: | ---: | ---: |
${variantRows}
`;
}

export async function loadBatchConfig(batchFile: string): Promise<BatchConfig> {
  const raw = await readFile(batchFile, 'utf8');
  const parsed = batchConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Invalid batch config: ${parsed.error.message}`);
  }
  if (parsed.data.variants) parseVariantList(parsed.data.variants.join(','));
  for (const experiment of parsed.data.experiments) {
    if (experiment.variants) parseVariantList(experiment.variants.join(','));
  }
  return parsed.data;
}

export async function runBatchExperiment(options: BatchCliOptions): Promise<BatchExperimentReport> {
  const config = await loadBatchConfig(options.batchFile);
  const defaultVariants = config.variants ?? options.variants;
  const includePosts = config.includePosts ?? options.includePosts;
  const cases: BatchCaseReport[] = [];

  await mkdir(options.outDir, { recursive: true });
  for (const experiment of config.experiments) {
    const caseId = experiment.id ?? `${experiment.pageType}-${slugify(experiment.topic)}`;
    const caseOutDir = path.join(options.outDir, caseId);
    const report = await runBriefExperiment({
      workspaceId: experiment.workspaceId,
      topic: experiment.topic,
      pageType: experiment.pageType,
      variants: experiment.variants ?? defaultVariants,
      includePosts: experiment.includePosts ?? includePosts,
      mcpUrl: options.mcpUrl,
      model: options.model,
      maxTokens: options.maxTokens,
      outDir: caseOutDir,
    });
    await writeExperimentArtifacts(caseOutDir, report);
    cases.push({ id: caseId, outDir: caseOutDir, report });
  }

  const batchReport = {
    generatedAt: new Date().toISOString(),
    batchFile: options.batchFile,
    mcpUrl: options.mcpUrl,
    cases,
  };
  await writeBatchArtifacts(options.outDir, batchReport);
  return batchReport;
}

async function writeExperimentArtifacts(outDir: string, report: ExperimentReport): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'report.md'), formatExperimentReport(report), 'utf8');
  await writeFile(path.join(outDir, 'scores.json'), JSON.stringify(report.results.map(result => result.score), null, 2), 'utf8');
  await writeFile(path.join(outDir, 'draft-scores.json'), JSON.stringify(report.results.map(result => result.draft?.score ?? null), null, 2), 'utf8');
  for (const result of report.results) {
    await writeFile(path.join(outDir, `${result.variant.id}.brief.json`), JSON.stringify(result.brief, null, 2), 'utf8');
    await writeFile(path.join(outDir, `${result.variant.id}.prompt.txt`), result.prompt, 'utf8');
    if (result.draft) {
      await writeFile(path.join(outDir, `${result.variant.id}.draft.html`), result.draft.html, 'utf8');
    }
  }
}

async function writeBatchArtifacts(outDir: string, batch: BatchExperimentReport): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'rollup.md'), formatBatchReport(batch), 'utf8');
  await writeFile(path.join(outDir, 'rollup.json'), JSON.stringify({
    generatedAt: batch.generatedAt,
    batchFile: batch.batchFile,
    mcpUrl: batch.mcpUrl,
    winners: summarizeBatchWinners(batch),
    cases: batch.cases.map(caseReport => ({
      id: caseReport.id,
      outDir: caseReport.outDir,
      workspaceId: caseReport.report.workspaceId,
      topic: caseReport.report.topic,
      pageType: caseReport.report.pageType,
      variants: caseReport.report.results.map(result => ({
        id: result.variant.id,
        briefScore: result.score.score,
        draftScore: result.draft?.score.score,
        effectiveScore: resultScore(result),
        warnings: [...result.score.warnings, ...(result.draft?.score.warnings ?? [])],
      })),
    })),
  }, null, 2), 'utf8');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'experiment';
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }

  if (process.argv.includes('--batch-file')) {
    const batchOptions = parseBatchExperimentArgs(process.argv.slice(2));
    const batch = await runBatchExperiment(batchOptions);
    console.log(formatBatchReport(batch));
    console.log(`\nBatch artifacts written to ${batchOptions.outDir}`);
    return;
  }

  const options = parseExperimentArgs(process.argv.slice(2));
  const report = await runBriefExperiment(options);
  await writeExperimentArtifacts(options.outDir, report);
  console.log(formatExperimentReport(report));
  console.log(`\nArtifacts written to ${options.outDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => {
    process.exit(0);
  }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  });
}
