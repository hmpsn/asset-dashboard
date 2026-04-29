import { getCollectionSchema, listCollections, discoverCmsUrls, buildStaticPathSet, toCmsPageId } from './webflow.js';
import { getWorkspacePages } from './workspace-data.js';
import { listWorkspaces } from './workspaces.js';
import { generateLeanSchema } from './schema/index.js';
import { callOpenAI } from './openai-helpers.js';
import { createLogger } from './logger.js';
import type { ContentBrief } from '../shared/types/content.ts';
import type { SchemaValidation } from './schema-validator.js';
import { fetchPageMeta } from './seo-audit.js';
import { fetchPublishedHtml } from './helpers.js';
import { resolveBaseUrl } from './url-helpers.js';

const log = createLogger('schema');

// Re-export from the standalone rich-results module so existing external callers
// (e.g. frontend SchemaPageCard.tsx, route handlers) keep working. The actual
// implementation lives in server/schema/rich-results.ts to break a circular
// import between schema-suggester.ts and the schema/ package.
export { checkRichResultsEligibility } from './schema/rich-results.js';
export type { RichResultEligibility } from './schema/rich-results.js';
import type { RichResultEligibility } from './schema/rich-results.js';

export interface SchemaPageSuggestion {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  existingSchemaJson?: Record<string, unknown>[];
  suggestedSchemas: SchemaSuggestion[];
  validationErrors?: string[];
  richResultsEligibility?: RichResultEligibility[];
  savedPageType?: string;  // Persisted page type from DB
}

export interface SchemaSuggestion {
  type: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  template: Record<string, unknown>;
}

// Page type hints for tailored schema generation
export type SchemaPageType = 'auto' | 'homepage' | 'pillar' | 'service' | 'audience' | 'lead-gen' | 'blog' | 'about' | 'contact' | 'location' | 'product' | 'partnership' | 'faq' | 'case-study' | 'comparison' | 'author' | 'howto' | 'video' | 'job-posting' | 'course' | 'event' | 'review' | 'pricing' | 'recipe' | 'generic';

export const PAGE_TYPE_LABELS: Record<SchemaPageType, string> = {
  auto: 'Auto-detect',
  homepage: 'Homepage',
  pillar: 'Pillar / Product Page',
  service: 'Service Page',
  audience: 'Audience / Use Case',
  'lead-gen': 'Lead-Gen / Conversion',
  blog: 'Blog Post',
  about: 'About / Team',
  contact: 'Contact',
  location: 'Location',
  product: 'Product',
  partnership: 'Partnership',
  faq: 'FAQ',
  'case-study': 'Case Study',
  comparison: 'Comparison',
  author: 'Author Profile',
  howto: 'How-To / Tutorial',
  video: 'Video Page',
  'job-posting': 'Job Posting',
  course: 'Course / Training',
  event: 'Event',
  review: 'Review',
  pricing: 'Pricing Page',
  recipe: 'Recipe',
  generic: 'General Page',
};

// Deterministic mapping: page type → recommended Schema.org types
export const PAGE_TYPE_SCHEMA_MAP: Record<SchemaPageType, { primary: string[]; secondary: string[] }> = {
  auto: { primary: [], secondary: [] },
  homepage: { primary: ['Organization', 'WebSite'], secondary: [] },
  pillar: { primary: ['Article', 'CollectionPage'], secondary: ['Person', 'BreadcrumbList'] },
  service: { primary: ['Service'], secondary: ['Offer', 'BreadcrumbList'] },
  audience: { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
  'lead-gen': { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
  blog: { primary: ['BlogPosting'], secondary: ['Person', 'BreadcrumbList', 'speakable'] },
  about: { primary: ['AboutPage', 'Organization'], secondary: ['Person', 'BreadcrumbList'] },
  contact: { primary: ['ContactPage'], secondary: ['Organization', 'BreadcrumbList'] },
  location: { primary: ['LocalBusiness'], secondary: ['Place', 'GeoCoordinates', 'BreadcrumbList'] },
  product: { primary: ['Product'], secondary: ['Offer', 'AggregateRating', 'BreadcrumbList'] },
  partnership: { primary: ['WebPage'], secondary: ['Organization', 'BreadcrumbList'] },
  faq: { primary: ['FAQPage'], secondary: ['BreadcrumbList'] },
  'case-study': { primary: ['Article'], secondary: ['Person', 'CreativeWork', 'BreadcrumbList'] },
  comparison: { primary: ['WebPage'], secondary: ['ItemList', 'BreadcrumbList'] },
  author: { primary: ['Person', 'ProfilePage'], secondary: ['BreadcrumbList'] },
  howto: { primary: ['HowTo'], secondary: ['Article', 'BreadcrumbList'] },
  video: { primary: ['VideoObject'], secondary: ['Article', 'BreadcrumbList'] },
  'job-posting': { primary: ['JobPosting'], secondary: ['BreadcrumbList'] },
  course: { primary: ['Course'], secondary: ['CourseInstance', 'BreadcrumbList'] },
  event: { primary: ['Event'], secondary: ['Offer', 'Place', 'BreadcrumbList'] },
  review: { primary: ['Review'], secondary: ['AggregateRating', 'BreadcrumbList'] },
  pricing: { primary: ['WebPage'], secondary: ['Offer', 'BreadcrumbList'] },
  recipe: { primary: ['Recipe'], secondary: ['HowToStep', 'NutritionInformation', 'BreadcrumbList'] },
  generic: { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
};

// (RICH_RESULTS_ELIGIBLE + checkRichResultsEligibility moved to ./schema/rich-results.ts
//  to break circular import. Re-exports near the top of this file preserve the public API.)

// Context from the workspace/strategy for richer schema generation
export interface SchemaContext {
  companyName?: string;
  liveDomain?: string;
  logoUrl?: string;
  businessContext?: string;
  brandVoice?: string;
  pageKeywords?: { primary: string; secondary: string[] };
  searchIntent?: string;
  siteKeywords?: string[];
  workspaceId?: string;
  knowledgeBase?: string;
  pageType?: SchemaPageType;
  _siteId?: string;  // Internal: passed through for site template storage
  _planContext?: string;  // Internal: plan-based role/entity context for this page
  _architectureTree?: import('./site-architecture.js').SiteNode;    // Full site tree for breadcrumb + nav generation
  _pageNode?: import('./site-architecture.js').SiteNode;            // Current page's node in the tree
  _ancestors?: import('./site-architecture.js').SiteNode[];         // Ancestor chain [root, ..., parent, target]
  _briefId?: string;  // Internal: linked content brief ID for E-E-A-T enrichment
  _pageAnalysis?: { topicCluster?: string; contentGaps?: string[]; optimizationScore?: number };  // Internal: from Page Intelligence
  _personasBlock?: string;  // Internal: audience personas for richer schema targeting
  _gscPageData?: { clicks: number; impressions: number; position: number; ctr: number };  // Internal: GSC per-page metrics
  _ga4PageData?: { pageviews: number; users: number; avgEngagementTime: number };  // Internal: GA4 per-page metrics
  _pageHealthScore?: number;  // Internal: 0-100 from analytics intelligence layer
  _pageHealthTrend?: 'improving' | 'declining' | 'stable';  // Internal: trend direction
  _quickWinStatus?: boolean;  // Internal: is this page a quick-win candidate?
  _faqOpportunities?: Array<{ query: string; impressions: number; position: number }>;  // Internal: question queries from GSC
  _businessProfile?: {  // Internal: verified business data — bypasses page-content verification checks
    phone?: string;
    email?: string;
    address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
    socialProfiles?: string[];
    openingHours?: string;
    foundedDate?: string;
    numberOfEmployees?: string;
  };
  /** Site-level SERP features from SEO data provider — used to steer schema type selection. */
  _serpFeatures?: { featuredSnippets: number; peopleAlsoAsk: number; localPack: boolean; videoCarousel: number };
  /** Referring-domain count from backlink profile — used to calibrate schema ambition. */
  _backlinkReferringDomains?: number;
  /** Validation errors from the prior schema generation for this page — used to avoid repeating known mistakes. */
  _existingErrors?: Array<{ message: string }>;
}

// ── Analytics Intelligence helpers for prompt enrichment ────────────

const QUESTION_PREFIXES = /^(how|what|why|when|where|which|can|do|does|is|are|should|will|would)\b/i;

/**
 * Extract question-type queries from GSC data that target a specific page.
 * These are FAQ candidates — questions people search to find this page.
 */
export function extractFaqOpportunities(
  queryPageData: Array<{ query: string; page: string; impressions: number; position: number }>,
  pageUrl: string,
): Array<{ query: string; impressions: number; position: number }> {
  return queryPageData
    .filter(row => row.page === pageUrl && QUESTION_PREFIXES.test(row.query))
    .map(({ query, impressions, position }) => ({ query, impressions, position }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
}

/**
 * Build the intelligence enrichment block for the schema generation prompt.
 * Returns empty string if no intelligence data is available.
 */
export function buildSchemaIntelligenceBlock(ctx: SchemaContext): string {
  const lines: string[] = [];

  if (ctx._pageHealthScore != null) {
    const trend = ctx._pageHealthTrend ? ` (${ctx._pageHealthTrend})` : '';
    lines.push(`- Page Health Score: ${ctx._pageHealthScore}/100${trend}`);
  }

  if (ctx._quickWinStatus === true) {
    lines.push(`- Quick Win: Yes — this page is close to page 1 and worth extra schema richness`);
  }

  const faqBlock: string[] = [];
  if (ctx._faqOpportunities && ctx._faqOpportunities.length > 0) {
    faqBlock.push(`\nFAQ OPPORTUNITIES (question queries people use to find this page — do NOT auto-generate FAQ schema from these; surface as insight only):`);
    for (const opp of ctx._faqOpportunities) {
      faqBlock.push(`- "${opp.query}" (${opp.impressions.toLocaleString()} impressions, pos ${Math.round(opp.position)})`);
    }
  }

  if (lines.length === 0 && faqBlock.length === 0) return '';

  const parts: string[] = [];
  if (lines.length > 0) {
    parts.push(`\nANALYTICS INTELLIGENCE:\n${lines.join('\n')}`);
  }
  if (faqBlock.length > 0) {
    parts.push(faqBlock.join('\n'));
  }

  return parts.join('\n');
}

// ── E-E-A-T extraction from content briefs ─────────────────────────
interface EeatData {
  authorName?: string;
  authorTitle?: string;
  expertiseTopics?: string[];
}

/**
 * Extract author/expertise data from a content brief's eeatGuidance field.
 * Returns null if the brief has no usable E-E-A-T data.
 */
export function extractEeatFromBrief(brief: ContentBrief): EeatData | null {
  const g = brief.eeatGuidance;
  if (!g) return null;

  const result: EeatData = {};

  // Try to extract an author name from the expertise or experience fields
  // Common patterns: "Written by Dr. Jane Smith", "Author: John Doe, MD", "Expert: ..."
  const namePatterns = [
    /(?:written by|author[:\s]+|by\s+)([A-Z][a-z]+(?: [A-Z][a-z'.]+){1,3})/i,
    /(?:expert[:\s]+|reviewed by[:\s]+)([A-Z][a-z]+(?: [A-Z][a-z'.]+){1,3})/i,
  ];

  const allText = [g.expertise, g.experience, g.authority, g.trust].filter(Boolean).join(' ');
  for (const pattern of namePatterns) {
    const match = allText.match(pattern);
    if (match) {
      result.authorName = match[1].trim();
      break;
    }
  }

  // Extract author title/credentials from expertise field
  const titlePatterns = [
    /(?:credentials?|title|role)[:\s]+([^.]+)/i,
    /\b((?:Dr|MD|PhD|CPA|RN|DDS|DMD|DO|JD|Esq)\b[^.]*)/i,
    /\b((?:certified|licensed|board-certified)[^.]+)/i,
  ];
  for (const pattern of titlePatterns) {
    const match = (g.expertise || '').match(pattern);
    if (match) {
      result.authorTitle = match[1].trim();
      break;
    }
  }

  // Extract expertise topics from the expertise field
  if (g.expertise) {
    // Look for comma-separated or "and"-separated topic lists
    const topicMatch = g.expertise.match(/(?:expertise in|specializ(?:es?|ing) in|expert in|covers?|topics?[:\s]+)([^.]+)/i);
    if (topicMatch) {
      result.expertiseTopics = topicMatch[1]
        .split(/,\s*|\s+and\s+/)
        .map(t => t.trim())
        .filter(t => t.length > 1 && t.length < 60);
    }
  }

  // Return null if nothing useful was extracted
  if (!result.authorName && !result.authorTitle && !result.expertiseTopics?.length) {
    return null;
  }

  return result;
}
/** Maps the lean generator's output shape to the public SchemaPageSuggestion. */
function leanToSuggestion(lean: import('./schema/index.js').LeanGeneratorOutput): SchemaPageSuggestion {
  return {
    pageId: lean.pageId,
    pageTitle: lean.pageTitle,
    slug: lean.slug,
    url: lean.url,
    existingSchemas: lean.existingSchemas,
    suggestedSchemas: lean.suggestedSchemas,
    validationErrors: lean.validationErrors,
    richResultsEligibility: lean.richResultsEligibility,
  };
}

export async function generateSchemaForPage(
  siteId: string,
  pageId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
  gscMap?: Map<string, { clicks: number; impressions: number; position: number; ctr: number }>,
  ga4Map?: Map<string, { pageviews: number; users: number; avgEngagementTime: number }>,
  queryPageData?: Array<{ query: string; page: string; impressions: number; position: number }>,
  insightsMap?: Map<string, { healthScore?: number; healthTrend?: string; isQuickWin?: boolean }>,
): Promise<SchemaPageSuggestion | null> {
  const baseUrl = await resolveBaseUrl({ liveDomain: ctx.liveDomain, webflowSiteId: siteId }, tokenOverride);
  if (!baseUrl) return null;

  const meta = await fetchPageMeta(pageId, tokenOverride);
  if (!meta) return null;

  const slug = meta.slug || '';
  const isHomepage = !slug || slug === 'index' || slug === 'home';

  // Fix 6: look up full publishedPath from getWorkspacePages — fetchPageMeta only
  // returns the leaf slug, which loses parent folder for nested pages (e.g. the page
  // published at /services/web-design would produce /web-design from slug alone).
  // Fall back to derived path if page list fails or page is not found.
  let publishedPath = isHomepage ? '/' : `/${slug}`;
  try {
    const wsId = ctx.workspaceId || listWorkspaces().find(w => w.webflowSiteId === siteId)?.id;
    if (wsId) {
      const allPages = await getWorkspacePages(wsId, siteId);
      const matched = allPages.find(p => p.id === pageId);
      if (matched?.publishedPath) {
        publishedPath = matched.publishedPath;
      }
    }
  } catch { /* page list failure — fall back to derived path */ } // catch-ok

  const url = isHomepage ? baseUrl : `${baseUrl}${publishedPath}`;
  const html = await fetchPublishedHtml(url);

  const lean = await generateLeanSchema({
    pageId,
    pageMeta: {
      title: meta.title || '',
      slug,
      publishedPath,
      seo: meta.seo,
      // Fix 4: pass CMS timestamps for datePublished/dateModified fallback —
      // The Webflow API may return these even though the local PageMeta interface omits them.
      lastPublished: (meta as unknown as Record<string, unknown>).lastPublished as string | undefined,
      createdOn: (meta as unknown as Record<string, unknown>).createdOn as string | undefined,
    },
    html: html || '',
    baseUrl,
    workspace: {
      name: ctx.companyName || '',
      publisherLogoUrl: ctx.logoUrl ?? null,
      businessProfile: ctx._businessProfile ?? null,
    },
  });

  // Surface unused parameters to satisfy TS noUnusedParameters via void casts.
  // These are kept in the signature for backwards compatibility with PR #354's
  // intelligence wiring; the lean generator does not use them in MVP scope.
  void gscMap; void ga4Map; void queryPageData; void insightsMap;

  return leanToSuggestion(lean);
}

export async function generateSchemaSuggestions(
  siteId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
  pageKeywordMap?: { pagePath: string; primaryKeyword: string; secondaryKeywords: string[]; searchIntent?: string; topicCluster?: string; contentGaps?: string[]; optimizationScore?: number }[],
  onProgress?: (partial: SchemaPageSuggestion[], done: boolean, message: string) => void,
  isCancelled?: () => boolean,
  gscMap?: Map<string, { clicks: number; impressions: number; position: number; ctr: number }>,
  ga4Map?: Map<string, { pageviews: number; users: number; avgEngagementTime: number }>,
  queryPageData?: Array<{ query: string; page: string; impressions: number; position: number }>,
  insightsMap?: Map<string, { healthScore?: number; healthTrend?: string; isQuickWin?: boolean }>,
  validationsByPageId?: Map<string, SchemaValidation>,
): Promise<SchemaPageSuggestion[]> {
  void pageKeywordMap; void gscMap; void ga4Map; void queryPageData; void insightsMap; void validationsByPageId;

  const baseUrl = await resolveBaseUrl({ liveDomain: ctx.liveDomain, webflowSiteId: siteId }, tokenOverride);
  if (!baseUrl) return [];

  const wsId = ctx.workspaceId || listWorkspaces().find(w => w.webflowSiteId === siteId)?.id;
  const pages = wsId ? await getWorkspacePages(wsId, siteId) : [];

  const results: SchemaPageSuggestion[] = [];

  for (const page of pages) {
    if (isCancelled?.()) break;
    const slug = page.slug || '';
    const url = (!slug || slug === 'index') ? baseUrl : `${baseUrl}/${slug}`;
    const html = await fetchPublishedHtml(url);
    const lean = await generateLeanSchema({
      pageId: page.id,
      pageMeta: {
        title: page.title || '',
        slug,
        publishedPath: page.publishedPath || (slug ? `/${slug}` : '/'),
        seo: page.seo,
      },
      html: html || '',
      baseUrl,
      workspace: {
        name: ctx.companyName || '',
        publisherLogoUrl: ctx.logoUrl ?? null,
        businessProfile: ctx._businessProfile ?? null,
      },
    });
    results.push(leanToSuggestion(lean));
    onProgress?.(results, false, `Processed ${results.length} of ${pages.length} static pages...`);
  }

  // CMS pages — same lean path
  {
    const staticPaths = buildStaticPathSet(pages);
    const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, 1000);
    for (const item of cmsUrls) {
      if (isCancelled?.()) break;
      const itemHtml = await fetchPublishedHtml(item.url);
      const itemLean = await generateLeanSchema({
        pageId: toCmsPageId(item.path),
        pageMeta: {
          title: item.pageName,
          slug: item.path.replace(/^\//, ''),
          publishedPath: item.path,
          seo: undefined,
          // Fix 4: CMS item timestamps not available via sitemap discovery — no fallback here
        },
        html: itemHtml || '',
        baseUrl,
        workspace: {
          name: ctx.companyName || '',
          publisherLogoUrl: ctx.logoUrl ?? null,
          businessProfile: ctx._businessProfile ?? null,
        },
      });
      results.push(leanToSuggestion(itemLean));
    }
  }

  onProgress?.(results, true, 'Done');
  return results;
}

// ── CMS Template Schema Generator ──
// Generates a schema template for a CMS collection page using Webflow's
// {{wf ...}} template tags so each collection item gets dynamic schema.

export interface CmsTemplateSchemaResult {
  templateString: string;           // Raw JSON-LD with {{wf}} tags (ready for custom code)
  schemaTypes: string[];            // Schema.org types generated
  fieldsUsed: string[];             // CMS field slugs referenced
  collectionName: string;
  collectionSlug: string;
}

// Convert placeholder __WF:path:Type__ to Webflow template tag
function wfTag(fieldPath: string, fieldType: string): string {
  return `{{wf {&quot;path&quot;:&quot;${fieldPath}&quot;,&quot;type&quot;:&quot;${fieldType}&quot;\\} }}`;
}

// Build a readable field list for the AI prompt
function describeFields(fields: Array<{ slug: string; displayName: string; type: string }>): string {
  return fields.map(f => `- ${f.slug} (${f.type}): "${f.displayName}"`).join('\n');
}

export async function generateCmsTemplateSchema(
  siteId: string,
  collectionId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
): Promise<CmsTemplateSchemaResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;

  // Fetch collection info
  const [collections, collSchema] = await Promise.all([
    listCollections(siteId, tokenOverride),
    getCollectionSchema(collectionId, tokenOverride),
  ]);
  const collection = collections.find(c => c.id === collectionId);
  if (!collection || collSchema.fields.length === 0) return null;

  const siteUrl = ctx.liveDomain
    ? (ctx.liveDomain.startsWith('http') ? ctx.liveDomain : `https://${ctx.liveDomain}`)
    : '';
  const companyName = ctx.companyName || '(company name)';

  // Build the field descriptions for the AI
  const fieldDescriptions = describeFields(collSchema.fields);

  // If no AI, build a basic template
  if (!apiKey) {
    return buildFallbackCmsTemplate(collection, collSchema.fields, siteUrl, companyName);
  }

  const prompt = `You are a Google Structured Data expert. Generate a JSON-LD schema template for a Webflow CMS collection page.

This schema will be injected into every page of the "${collection.displayName}" collection (slug: "${collection.slug}"). Instead of static values, use PLACEHOLDER tags for CMS field data.

PLACEHOLDER FORMAT: Use exactly this syntax for dynamic CMS values:
  __WF:field-slug:FieldType__

For reference fields (fields from a linked collection), use:
  __WF:ref-field-slug:sub-field-slug:FieldType__

SITE INFO:
- Company: ${companyName}
- Site URL: ${siteUrl || '(not available)'}
- Logo: ${ctx.logoUrl || '(not available)'}
- Collection: ${collection.displayName} (slug: ${collection.slug})
${ctx.businessContext ? `- Business Context: ${ctx.businessContext}` : ''}

AVAILABLE CMS FIELDS:
${fieldDescriptions}

REQUIREMENTS:
1. Return ONE JSON-LD object with "@context": "https://schema.org" and an "@graph" array
2. Map CMS fields to the most appropriate schema.org properties based on field names and types
3. Use __WF:slug:PlainText__ for the item slug in URLs: "${siteUrl}/${collection.slug}/__WF:slug:PlainText__"
4. Use __WF:name:PlainText__ for the item name
5. For Phone fields use __WF:field-slug:Phone__
6. For ImageRef fields use __WF:field-slug:ImageRef__
7. For Email fields use __WF:field-slug:Email__
8. For Date fields use __WF:field-slug:Date__
9. For Link fields use __WF:field-slug:Link__
10. For reference fields pointing to another collection's field, use __WF:ref-field:sub-field:PlainText__
11. Include Organization node with static company data (not dynamic)
12. Include BreadcrumbList: Home → ${collection.displayName} → __WF:name:PlainText__
13. Choose the most appropriate @type for collection items (Dentist, Article, BlogPosting, Product, Service, Event, Person, Place, etc.) based on the collection name and fields
14. ONLY use fields that exist in the AVAILABLE CMS FIELDS list above
15. If a field doesn't exist for a schema property, OMIT that property entirely — do not guess field names
16. NEVER include empty arrays, empty strings, or empty objects
17. Use consistent @id naming: "${siteUrl}/${collection.slug}/__WF:slug:PlainText__/#typename"

Return ONLY the raw JSON-LD. No markdown, no explanation.`;

  try {
    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.2,
      feature: 'cms-schema-template',
      maxRetries: 3,
    });

    const content = aiResult.text;
    if (!content) return null;

    let jsonStr = content;
    const mdMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch) jsonStr = mdMatch[1].trim();

    // Validate it's parseable JSON (with placeholders as strings)
    try { JSON.parse(jsonStr); } catch (err) {
      log.debug({ err }, 'schema-suggester: expected error — degrading gracefully');
      log.error('AI returned invalid JSON');
      return null;
    }

    // Convert placeholders to Webflow template tags
    const templateString = convertPlaceholders(jsonStr);

    // Extract which fields were used
    const fieldsUsed = extractUsedFields(jsonStr, collSchema.fields);

    // Extract schema types
    const typeMatches = jsonStr.match(/"@type"\s*:\s*"([^"]+)"/g) || [];
    const schemaTypes = typeMatches
      .map(m => m.match(/"@type"\s*:\s*"([^"]+)"/)?.[1])
      .filter(Boolean) as string[];

    return {
      templateString,
      schemaTypes: [...new Set(schemaTypes)],
      fieldsUsed,
      collectionName: collection.displayName,
      collectionSlug: collection.slug,
    };
  } catch (err) {
    log.error({ err: err }, 'AI generation failed');
    return null;
  }
}

// Convert __WF:path:Type__ placeholders to {{wf {&quot;...&quot;} }} tags
function convertPlaceholders(jsonStr: string): string {
  // Match __WF:path:Type__ and __WF:ref:subfield:Type__
  return jsonStr.replace(/__WF:([^_]+)__/g, (_match, inner: string) => {
    const parts = inner.split(':');
    if (parts.length === 3) {
      // Reference field: __WF:ref-field:sub-field:Type__
      const [refField, subField, type] = parts;
      return wfTag(`${refField}:${subField}`, type);
    } else if (parts.length === 2) {
      // Direct field: __WF:field-slug:Type__
      const [fieldSlug, type] = parts;
      return wfTag(fieldSlug, type);
    }
    return _match; // leave unrecognized patterns as-is
  });
}

// Figure out which CMS fields were referenced
function extractUsedFields(jsonStr: string, allFields: Array<{ slug: string }>): string[] {
  const used = new Set<string>();
  const matches = jsonStr.matchAll(/__WF:([^:_]+)/g);
  for (const m of matches) {
    if (allFields.some(f => f.slug === m[1])) {
      used.add(m[1]);
    }
  }
  return [...used];
}

// Fallback template without AI
function buildFallbackCmsTemplate(
  collection: { displayName: string; slug: string },
  fields: Array<{ slug: string; displayName: string; type: string }>,
  siteUrl: string,
  companyName: string,
): CmsTemplateSchemaResult {
  const baseItemUrl = `${siteUrl}/${collection.slug}/${wfTag('slug', 'PlainText')}`;
  const nameTag = wfTag('name', 'PlainText');

  const graph: string[] = [];

  // Organization
  graph.push(`    {
      "@type": "Organization",
      "@id": "${siteUrl}/#organization",
      "name": "${companyName}",
      "url": "${siteUrl}"
    }`);

  // WebPage
  graph.push(`    {
      "@type": "WebPage",
      "@id": "${baseItemUrl}/#webpage",
      "url": "${baseItemUrl}",
      "name": "${nameTag}",
      "inLanguage": "en"
    }`);

  // BreadcrumbList
  graph.push(`    {
      "@type": "BreadcrumbList",
      "@id": "${baseItemUrl}/#breadcrumb",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "${siteUrl}/"},
        {"@type": "ListItem", "position": 2, "name": "${collection.displayName}", "item": "${siteUrl}/${collection.slug}"},
        {"@type": "ListItem", "position": 3, "name": "${nameTag}", "item": "${baseItemUrl}"}
      ]
    }`);

  const templateString = `{
  "@context": "https://schema.org",
  "@graph": [
${graph.join(',\n')}
  ]
}`;

  const fieldsUsed = ['name', 'slug'].filter(s => fields.some(f => f.slug === s));

  return {
    templateString,
    schemaTypes: ['Organization', 'WebPage', 'BreadcrumbList'],
    fieldsUsed,
    collectionName: collection.displayName,
    collectionSlug: collection.slug,
  };
}
