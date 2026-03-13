import { listPages, filterPublishedPages, discoverCmsUrls, buildStaticPathSet, getCollectionSchema, listCollections } from './webflow.js';
import { callOpenAI } from './openai-helpers.js';
import { createLogger } from './logger.js';

const log = createLogger('schema');

const WEBFLOW_API = 'https://api.webflow.com/v2';

function getToken(tokenOverride?: string): string | null {
  return tokenOverride || process.env.WEBFLOW_API_TOKEN || null;
}

export interface SchemaPageSuggestion {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  existingSchemaJson?: Record<string, unknown>[];
  suggestedSchemas: SchemaSuggestion[];
  validationErrors?: string[];
}

export interface SchemaSuggestion {
  type: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  template: Record<string, unknown>;
}

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
}

// Google required fields per @type (for validation)
const REQUIRED_FIELDS: Record<string, string[]> = {
  Article: ['headline', 'author', 'datePublished', 'image'],
  BlogPosting: ['headline', 'author', 'datePublished', 'image'],
  NewsArticle: ['headline', 'author', 'datePublished', 'image'],
  FAQPage: ['mainEntity'],
  Organization: ['name'],
  LocalBusiness: ['name', 'address'],
  WebSite: ['name', 'url'],
  WebPage: ['name'],
  BreadcrumbList: ['itemListElement'],
  Service: ['name'],
  Product: ['name'],
  Event: ['name', 'startDate', 'location'],
  HowTo: ['name', 'step'],
  Review: ['itemReviewed', 'author'],
  VideoObject: ['name', 'uploadDate', 'thumbnailUrl'],
  Person: ['name'],
};

function validateGraphNode(node: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const type = node['@type'] as string;
  if (!type) { errors.push('Missing @type'); return errors; }
  const required = REQUIRED_FIELDS[type];
  if (!required) return []; // unknown type, skip validation
  for (const field of required) {
    const val = node[field];
    if (val === undefined || val === null || val === '' || val === '[') {
      errors.push(`${type}: missing required field "${field}"`);
    }
    // Check for unfilled placeholders
    if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
      errors.push(`${type}: placeholder not filled for "${field}"`);
    }
  }
  return errors;
}

function validateUnifiedSchema(schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!schema['@context']) errors.push('Missing @context');
  const graph = schema['@graph'] as Record<string, unknown>[];
  if (!Array.isArray(graph)) { errors.push('Missing @graph array'); return errors; }
  for (const node of graph) {
    errors.push(...validateGraphNode(node));
  }
  return errors;
}

interface PageMeta {
  id: string;
  title: string;
  slug: string;
  seo?: { title?: string; description?: string };
}

async function fetchPageMeta(pageId: string, tokenOverride?: string): Promise<PageMeta | null> {
  const token = getToken(tokenOverride);
  if (!token) return null;
  try {
    const res = await fetch(`${WEBFLOW_API}/pages/${pageId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json() as PageMeta;
  } catch { return null; }
}

async function fetchPublishedHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

async function getSiteSubdomain(siteId: string, tokenOverride?: string): Promise<string | null> {
  const token = getToken(tokenOverride);
  if (!token) return null;
  try {
    const res = await fetch(`${WEBFLOW_API}/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json() as { shortName?: string };
    return data.shortName || null;
  } catch { return null; }
}

// Detect existing JSON-LD schemas in HTML
function extractExistingSchemas(html: string): { types: string[]; json: Record<string, unknown>[] } {
  const types: string[] = [];
  const json: Record<string, unknown>[] = [];
  const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      json.push(data);
      if (data['@type']) types.push(data['@type']);
      if (Array.isArray(data['@graph'])) {
        for (const item of data['@graph']) {
          if (item['@type']) types.push(item['@type']);
        }
      }
    } catch { /* malformed JSON-LD */ }
  }
  return { types, json };
}

// --- AI-Powered Unified Schema Generation ---

function extractPageContent(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

function extractStructuredInfo(html: string) {
  const emails = (html.match(/[\w.-]+@[\w.-]+\.\w+/g) || []).slice(0, 3);
  const phones = (html.match(/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || []).slice(0, 2);
  const images = (html.match(/src=["']([^"']*(?:jpg|jpeg|png|webp)[^"']*)["']/gi) || []).slice(0, 5).map(m => {
    const s = m.match(/src=["']([^"']+)["']/i);
    return s ? s[1] : '';
  }).filter(Boolean);
  // Extract questions (headings or summaries ending with ?)
  const questions = (html.match(/<(?:h[2-4]|summary)[^>]*>([^<]*\?)/gi) || []).map(m => m.replace(/<[^>]+>/g, '').trim()).slice(0, 10);
  // Extract author info
  const authorMatch = html.match(/(?:author|written\s*by|posted\s*by)[:\s]*([^<,]{2,40})/i);
  const author = authorMatch ? authorMatch[1].trim() : '';
  // Extract date
  const dateMatch = html.match(/(?:datetime|published|date)[=:"'\s]*(\d{4}-\d{2}-\d{2})/i);
  const publishDate = dateMatch ? dateMatch[1] : '';
  return { emails, phones, images, questions, author, publishDate };
}

// Post-process AI output: strip empty arrays, empty strings, and empty objects
function cleanSchema(obj: Record<string, unknown>): Record<string, unknown> {
  const clean = (val: unknown): unknown => {
    if (val === null || val === undefined) return undefined;
    if (typeof val === 'string') return val.trim() === '' ? undefined : val;
    if (Array.isArray(val)) {
      const filtered = val.map(clean).filter(v => v !== undefined);
      return filtered.length === 0 ? undefined : filtered;
    }
    if (typeof val === 'object') {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        const cv = clean(v);
        if (cv !== undefined) cleaned[k] = cv;
      }
      // Keep objects that have at least one meaningful key (besides @type/@id)
      const meaningfulKeys = Object.keys(cleaned).filter(k => k !== '@type' && k !== '@id');
      if (Object.keys(cleaned).length === 0) return undefined;
      if (meaningfulKeys.length === 0 && !cleaned['@type']) return undefined;
      return cleaned;
    }
    return val;
  };
  return clean(obj) as Record<string, unknown>;
}

async function aiGenerateUnifiedSchema(
  pageTitle: string,
  slug: string,
  seoTitle: string,
  seoDesc: string,
  html: string | null,
  existingSchemas: string[],
  isHomepage: boolean,
  baseUrl: string,
  ctx: SchemaContext,
): Promise<{ schema: Record<string, unknown>; reason: string; errors: string[] } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const pageUrl = (!slug || slug === 'index' || slug === 'home') ? baseUrl : `${baseUrl}/${slug}`;
  const pageContent = html ? extractPageContent(html) : '';
  const info = html ? extractStructuredInfo(html) : { emails: [], phones: [], images: [], questions: [], author: '', publishDate: '' };

  const companyName = ctx.companyName || '(unknown — infer from page content)';
  const siteUrl = ctx.liveDomain ? (ctx.liveDomain.startsWith('http') ? ctx.liveDomain : `https://${ctx.liveDomain}`) : baseUrl;

  // Build keyword context
  let keywordBlock = '';
  if (ctx.pageKeywords) {
    keywordBlock = `\nTARGET KEYWORDS FOR THIS PAGE:\n- Primary: ${ctx.pageKeywords.primary}\n- Secondary: ${ctx.pageKeywords.secondary.join(', ') || 'none'}`;
    if (ctx.searchIntent) keywordBlock += `\n- Search Intent: ${ctx.searchIntent}`;
  }
  if (ctx.siteKeywords?.length) {
    keywordBlock += `\nSITE-LEVEL KEYWORDS: ${ctx.siteKeywords.slice(0, 10).join(', ')}`;
  }

  const prompt = `You are a Google Structured Data expert. Generate ONE production-ready JSON-LD schema for this page using the @graph pattern. The schema must pass Google's Rich Results Test with zero errors.

SITE INFO:
- Company: ${companyName}
- Site URL: ${siteUrl}
- Logo: ${ctx.logoUrl || '(not available)'}
${ctx.businessContext ? `- Business Context: ${ctx.businessContext}` : ''}
${keywordBlock}
${ctx.knowledgeBase ? `\nBUSINESS KNOWLEDGE BASE (use ONLY confirmed facts from this for schema fields like credentials, locations, sameAs URLs, specialties — never fabricate):\n${ctx.knowledgeBase.slice(0, 2000)}` : ''}

PAGE INFO:
- URL: ${pageUrl}
- Title: ${seoTitle || pageTitle}
- Meta Description: ${seoDesc || '(none)'}
- Is Homepage: ${isHomepage}
- Existing Schemas: ${existingSchemas.length > 0 ? existingSchemas.join(', ') : 'None'}
${info.author ? `- Author: ${info.author}` : ''}
${info.publishDate ? `- Publish Date: ${info.publishDate}` : ''}
${info.emails.length ? `- Emails: ${info.emails.join(', ')}` : ''}
${info.phones.length ? `- Phones: ${info.phones.join(', ')}` : ''}
${info.images.length ? `- Key Images: ${info.images.slice(0, 3).join(', ')}` : ''}
${info.questions.length ? `- FAQ Questions Found: ${info.questions.join(' | ')}` : ''}

PAGE CONTENT (excerpt):
${pageContent.slice(0, 3000)}

REQUIREMENTS:
1. Return ONE JSON-LD object with "@context": "https://schema.org" and an "@graph" array
2. The @graph MUST include a WebPage node on every page
3. Include an Organization node with "@id": "${siteUrl}/#organization" on every page
4. ONLY add a WebSite node on the HOMEPAGE (isHomepage=true). NEVER include WebSite on subpages.
5. NEVER include a SearchAction unless the site has a real, confirmed search endpoint. Do NOT use "?s={search_term_string}" — that is a WordPress convention.
6. Add page-specific types based on content (Article, FAQPage, Service, Product, BreadcrumbList, HowTo, Event, LocalBusiness, Dataset, etc.)
7. Use "@id" cross-references between nodes (e.g. Organization "@id": "${siteUrl}/#organization")
8. Fill ALL values from actual page content — ZERO placeholders, ZERO fabricated data
9. CRITICAL: NEVER invent or fabricate addresses, phone numbers, email addresses, opening hours, geo coordinates, or any contact information. Only include these fields if the EXACT data appears in the page content above. If a LocalBusiness is appropriate but the page lacks an address, include the LocalBusiness with only the fields you can confirm from the content (name, url, description). Omit address/telephone/openingHours/geo entirely if not found.
10. For images, use full absolute URLs (prefix with ${siteUrl} if relative). Only use image URLs found in the page content.
11. FAQPage: extract REAL questions and answers from the page content. Never fabricate Q&A pairs.
12. Article/BlogPosting: use real author name, real dates, real headline from the content. ALWAYS include "author" with "@type": "Person" and real credentials if found. If a medical/health reviewer is mentioned, add "reviewedBy" with "@type": "Person" and their credentials.
13. BreadcrumbList: use the FLAT format — each ListItem has "name" and "item" (URL string) directly, NOT nested inside an "item" object. Example: {"@type":"ListItem","position":1,"name":"Home","item":"${siteUrl}/"}
14. LocalBusiness for multi-location/region pages: include "parentOrganization": {"@id": "${siteUrl}/#organization"} to link the location to the parent brand
15. Every @type must have all Google-required fields filled with REAL data from the page
16. If you cannot determine a required value from the content, OMIT that @type entirely rather than using a placeholder or fabricating data
17. HEALTHCARE / MEDICAL SITES: If the business context or page content indicates a healthcare provider (dental, medical, clinic, hospital, therapy, etc.):
    - Use "MedicalBusiness" or more specific subtypes ("Dentist", "Physician", "Optician", etc.) instead of generic "LocalBusiness"
    - For treatment/procedure pages, use "MedicalProcedure" with procedureType, howPerformed, preparation, followup if found in content
    - For provider/doctor profile pages, use "Physician" with medicalSpecialty, credentials, and hospitalAffiliation from content
    - For procedural how-to content, use "HowTo" with step-by-step instructions extracted from the page
18. DATASET PAGES: If the page presents data tables, rankings, indexes, or structured data collections, include "Dataset" schema with name, description, distribution (if downloadable), dateModified, and creator referencing the Organization
19. ENTITY LINKING (sameAs): On the Organization node, include a "sameAs" array with links to the business's verified external profiles (Google Business, LinkedIn, Facebook, Yelp, industry association pages) — but ONLY if these URLs actually appear in the page content or site footer. Never fabricate profile URLs

QUALITY RULES — strict:
17. NEVER include empty arrays or empty strings. If a property has no value (e.g. "sameAs": []), OMIT it entirely.
18. NEVER include empty objects. If a nested object would have no meaningful properties, omit the parent property.
19. Use CONSISTENT @id naming across all pages. Follow this exact convention:
    - Organization: "${siteUrl}/#organization"
    - WebSite (homepage only): "${siteUrl}/#website"
    - WebPage: "{pageUrl}/#webpage"
    - BreadcrumbList: "{pageUrl}/#breadcrumb"
    - LocalBusiness: "{pageUrl}/#localbusiness"
    - Service (mainEntity): "{pageUrl}/#service"
    - FAQPage: "{pageUrl}/#faq"
    - Article/BlogPosting: "{pageUrl}/#article"
20. For openingHours, prefer the OpeningHoursSpecification format:
    "openingHoursSpecification": [{"@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday",...], "opens": "08:00", "closes": "17:00"}]

Return ONLY the JSON-LD object. No markdown, no explanation, no wrapping.`;

  try {
    const aiResult = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.2,
      feature: 'schema-generation',
      workspaceId: ctx.workspaceId,
      maxRetries: 4,
    });

    const content = aiResult.text;
    if (!content) return null;

    let jsonStr = content;
    const mdMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch) jsonStr = mdMatch[1].trim();

    const rawSchema = JSON.parse(jsonStr) as Record<string, unknown>;
    const schema = cleanSchema(rawSchema);

    // Ensure it has @graph structure
    if (!schema['@graph'] && schema['@type']) {
      // AI returned a single type instead of @graph — wrap it
      const wrapped = { '@context': 'https://schema.org', '@graph': [schema] };
      delete (wrapped['@graph'][0] as Record<string, unknown>)['@context'];
      const errors = validateUnifiedSchema(wrapped);
      const types = (wrapped['@graph'] as Record<string, unknown>[]).map(n => n['@type']).filter(Boolean);
      return { schema: wrapped, reason: `Unified schema with ${types.join(', ')}`, errors };
    }

    const errors = validateUnifiedSchema(schema);
    const graph = schema['@graph'] as Record<string, unknown>[];
    const types = graph?.map(n => n['@type']).filter(Boolean) || [];
    return { schema, reason: `Unified @graph schema with ${types.join(', ')}`, errors };
  } catch (err: unknown) {
    log.error({ err: err }, 'AI unified generation error');
    return null;
  }
}

// Fallback: build a basic @graph schema without AI
function buildFallbackSchema(
  pageTitle: string,
  slug: string,
  seoTitle: string,
  seoDesc: string,
  isHomepage: boolean,
  baseUrl: string,
  ctx: SchemaContext,
): Record<string, unknown> {
  const pageUrl = (!slug || slug === 'index' || slug === 'home') ? baseUrl : `${baseUrl}/${slug}`;
  const siteUrl = ctx.liveDomain ? (ctx.liveDomain.startsWith('http') ? ctx.liveDomain : `https://${ctx.liveDomain}`) : baseUrl;
  const companyName = ctx.companyName || seoTitle || pageTitle;

  const graph: Record<string, unknown>[] = [
    {
      '@type': 'Organization',
      '@id': `${siteUrl}/#organization`,
      name: companyName,
      url: siteUrl,
      ...(ctx.logoUrl ? { logo: { '@type': 'ImageObject', url: ctx.logoUrl } } : {}),
    },
    {
      '@type': 'WebPage',
      '@id': `${pageUrl}/#webpage`,
      url: pageUrl,
      name: seoTitle || pageTitle,
      ...(seoDesc ? { description: seoDesc } : {}),
      isPartOf: { '@id': `${siteUrl}/#website` },
      about: { '@id': `${siteUrl}/#organization` },
    },
  ];

  if (isHomepage) {
    graph.push({
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: siteUrl,
      name: companyName,
      publisher: { '@id': `${siteUrl}/#organization` },
    });
  }

  // Add BreadcrumbList for non-homepage
  if (!isHomepage && slug) {
    const parts = slug.split('/').filter(Boolean);
    if (parts.length >= 1) {
      graph.push({
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
          ...parts.map((part, i) => ({
            '@type': 'ListItem',
            position: i + 2,
            name: part.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            item: `${siteUrl}/${parts.slice(0, i + 1).join('/')}`,
          })),
        ],
      });
    }
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

export async function generateSchemaForPage(
  siteId: string,
  pageId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
): Promise<SchemaPageSuggestion | null> {
  const subdomain = await getSiteSubdomain(siteId, tokenOverride);
  const liveDomain = ctx.liveDomain;
  const baseUrl = liveDomain
    ? (liveDomain.startsWith('http') ? liveDomain : `https://${liveDomain}`)
    : subdomain ? `https://${subdomain}.webflow.io` : '';
  if (!baseUrl) return null;

  const meta = await fetchPageMeta(pageId, tokenOverride);
  if (!meta) return null;

  const slug = meta.slug || '';
  const url = (!slug || slug === 'index') ? baseUrl : `${baseUrl}/${slug}`;
  const isHomepage = !slug || slug === '' || slug === 'home' || slug === 'index';
  const html = await fetchPublishedHtml(url);
  const seoTitle = meta.seo?.title || meta.title || '';
  const seoDesc = meta.seo?.description || '';
  const { types: existingSchemas, json: existingSchemaJson } = html ? extractExistingSchemas(html) : { types: [], json: [] };

  // Try AI unified schema first
  const aiResult = await aiGenerateUnifiedSchema(
    meta.title, slug, seoTitle, seoDesc,
    html, existingSchemas, isHomepage, baseUrl, ctx,
  );

  let suggestedSchemas: SchemaSuggestion[];
  let validationErrors: string[] = [];

  if (aiResult) {
    const types = ((aiResult.schema['@graph'] as Record<string, unknown>[]) || []).map(n => n['@type']).filter(Boolean);
    suggestedSchemas = [{
      type: types.join(' + '),
      reason: aiResult.reason,
      priority: 'high',
      template: aiResult.schema,
    }];
    validationErrors = aiResult.errors;
  } else {
    // Fallback to basic @graph schema
    const fallback = buildFallbackSchema(meta.title, slug, seoTitle, seoDesc, isHomepage, baseUrl, ctx);
    const types = ((fallback['@graph'] as Record<string, unknown>[]) || []).map(n => n['@type']).filter(Boolean);
    suggestedSchemas = [{
      type: types.join(' + '),
      reason: `Basic schema with ${types.join(', ')} (AI unavailable — add OPENAI_API_KEY for richer schemas)`,
      priority: 'medium',
      template: fallback,
    }];
    validationErrors = validateUnifiedSchema(fallback);
  }

  return {
    pageId,
    pageTitle: meta.title,
    slug,
    url,
    existingSchemas,
    existingSchemaJson: existingSchemaJson.length > 0 ? existingSchemaJson : undefined,
    suggestedSchemas,
    validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
  };
}

export async function generateSchemaSuggestions(
  siteId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
  pageKeywordMap?: { pagePath: string; primaryKeyword: string; secondaryKeywords: string[]; searchIntent?: string }[],
  onProgress?: (partial: SchemaPageSuggestion[], done: boolean, message: string) => void,
  isCancelled?: () => boolean,
): Promise<SchemaPageSuggestion[]> {
  const subdomain = await getSiteSubdomain(siteId, tokenOverride);
  const liveDomain = ctx.liveDomain;
  const baseUrl = liveDomain
    ? (liveDomain.startsWith('http') ? liveDomain : `https://${liveDomain}`)
    : subdomain ? `https://${subdomain}.webflow.io` : '';
  log.info(`baseUrl=${baseUrl}, liveDomain=${liveDomain || '(none)'}`);
  if (!baseUrl) {
    log.error({ detail: siteId }, 'No subdomain or liveDomain found for site');
    return [];
  }

  const allPages = await listPages(siteId, tokenOverride);
  const pages = filterPublishedPages(allPages).filter(
    (p: { title: string; slug: string }) => !(p.title || '').toLowerCase().includes('password') && !(p.slug || '').toLowerCase().includes('password')
  );
  log.info(`${pages.length} published pages to analyze`);

  const results: SchemaPageSuggestion[] = [];
  const hasAI = !!process.env.OPENAI_API_KEY;
  // gpt-4.1-mini has 4M TPM at Tier 3 — batch 8 AI calls at a time safely
  const batch = hasAI ? 8 : 5;

  // Helper: find keyword context for a page path (supports nested paths like /about/team)
  const getPageKeywords = (pathOrSlug: string): SchemaContext['pageKeywords'] => {
    if (!pageKeywordMap) return undefined;
    const normalized = pathOrSlug.startsWith('/') ? pathOrSlug : `/${pathOrSlug}`;
    const match = pageKeywordMap.find(p =>
      p.pagePath === normalized || p.pagePath === `${normalized}/` || p.pagePath === pathOrSlug
    );
    if (match) return { primary: match.primaryKeyword, secondary: match.secondaryKeywords || [] };
    return undefined;
  };
  const getPageIntent = (pathOrSlug: string): string | undefined => {
    if (!pageKeywordMap) return undefined;
    const normalized = pathOrSlug.startsWith('/') ? pathOrSlug : `/${pathOrSlug}`;
    return pageKeywordMap.find(p => p.pagePath === normalized || p.pagePath === `${normalized}/`)?.searchIntent;
  };

  for (let i = 0; i < pages.length; i += batch) {
    if (isCancelled?.()) { log.info('Cancelled by user'); return results; }
    if (i > 0 && hasAI) await new Promise(r => setTimeout(r, 1500));
    const chunk = pages.slice(i, i + batch);
    log.info(`Processing static pages ${i + 1}-${Math.min(i + batch, pages.length)} of ${pages.length}`);
    const chunkResults = await Promise.all(
      chunk.map(async (page) => {
        // Use publishedPath for full URL (handles nested pages like /about/team)
        const pagePath = page.publishedPath || (page.slug ? `/${page.slug}` : '');
        const url = (!pagePath || pagePath === '/' || page.slug === 'index') ? baseUrl : `${baseUrl}${pagePath}`;
        const isHomepage = !page.slug || page.slug === '' || page.slug === 'home' || page.slug === 'index';
        const [meta, html] = await Promise.all([
          fetchPageMeta(page.id, tokenOverride),
          fetchPublishedHtml(url),
        ]);

        const seoTitle = meta?.seo?.title || page.title || '';
        const seoDesc = meta?.seo?.description || '';
        const { types: existingSchemas, json: existingSchemaJson } = html ? extractExistingSchemas(html) : { types: [], json: [] };

        // Build page-specific context (use full path for nested pages)
        const lookupPath = pagePath || `/${page.slug}`;
        const pageCtx: SchemaContext = {
          ...ctx,
          pageKeywords: getPageKeywords(lookupPath),
          searchIntent: getPageIntent(lookupPath),
        };

        let suggestedSchemas: SchemaSuggestion[];
        let validationErrors: string[] = [];

        if (hasAI) {
          const aiResult = await aiGenerateUnifiedSchema(
            page.title, page.slug, seoTitle, seoDesc,
            html, existingSchemas, isHomepage, baseUrl, pageCtx,
          );
          if (aiResult) {
            const types = ((aiResult.schema['@graph'] as Record<string, unknown>[]) || []).map(n => n['@type']).filter(Boolean);
            suggestedSchemas = [{
              type: types.join(' + '),
              reason: aiResult.reason,
              priority: 'high',
              template: aiResult.schema,
            }];
            validationErrors = aiResult.errors;
          } else {
            const fallback = buildFallbackSchema(page.title, page.slug, seoTitle, seoDesc, isHomepage, baseUrl, pageCtx);
            const types = ((fallback['@graph'] as Record<string, unknown>[]) || []).map(n => n['@type']).filter(Boolean);
            suggestedSchemas = [{
              type: types.join(' + '),
              reason: `Basic schema with ${types.join(', ')} (AI generation failed for this page)`,
              priority: 'medium',
              template: fallback,
            }];
            validationErrors = validateUnifiedSchema(fallback);
          }
        } else {
          const fallback = buildFallbackSchema(page.title, page.slug, seoTitle, seoDesc, isHomepage, baseUrl, pageCtx);
          const types = ((fallback['@graph'] as Record<string, unknown>[]) || []).map(n => n['@type']).filter(Boolean);
          suggestedSchemas = [{
            type: types.join(' + '),
            reason: `Basic schema with ${types.join(', ')} (add OPENAI_API_KEY for richer schemas)`,
            priority: 'medium',
            template: fallback,
          }];
          validationErrors = validateUnifiedSchema(fallback);
        }

        return {
          pageId: page.id,
          pageTitle: page.title,
          slug: pagePath ? pagePath.replace(/^\//, '') : page.slug,
          url,
          existingSchemas,
          existingSchemaJson: existingSchemaJson.length > 0 ? existingSchemaJson : undefined,
          suggestedSchemas,
          validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
        } as SchemaPageSuggestion;
      })
    );
    results.push(...chunkResults.filter(Boolean) as SchemaPageSuggestion[]);
    onProgress?.(results, false, `Processed ${Math.min(i + batch, pages.length)} of ${pages.length} static pages...`);
  }

  // ── Also analyze CMS/collection pages discovered via sitemap ──
  const staticPaths = buildStaticPathSet(pages);
  const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, 1000);
  if (cmsUrls.length > 0) {
    log.info(`Also analyzing ${cmsUrls.length} CMS pages`);
    for (let i = 0; i < cmsUrls.length; i += batch) {
      if (isCancelled?.()) { log.info('Cancelled by user'); return results; }
      if (i > 0 && hasAI) await new Promise(r => setTimeout(r, 1500));
      const chunk = cmsUrls.slice(i, i + batch);
      log.info(`Processing CMS pages ${i + 1}-${Math.min(i + batch, cmsUrls.length)} of ${cmsUrls.length}`);
      const chunkResults = await Promise.all(
        chunk.map(async (item) => {
          const slug = item.path.replace(/^\//, '');
          const isHomepage = false;
          const html = await fetchPublishedHtml(item.url);
          const htmlTitle = html ? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '') : '';
          const { types: existingSchemas, json: existingSchemaJson } = html ? extractExistingSchemas(html) : { types: [], json: [] };

          const pageCtx: SchemaContext = {
            ...ctx,
            pageKeywords: getPageKeywords(slug),
            searchIntent: getPageIntent(slug),
          };

          let suggestedSchemas: SchemaSuggestion[];
          let validationErrors: string[] = [];

          if (hasAI) {
            const aiResult = await aiGenerateUnifiedSchema(
              item.pageName, slug, htmlTitle, '',
              html, existingSchemas, isHomepage, baseUrl, pageCtx,
            );
            if (aiResult) {
              const types = ((aiResult.schema['@graph'] as Record<string, unknown>[]) || []).map(n => n['@type']).filter(Boolean);
              suggestedSchemas = [{
                type: types.join(' + '),
                reason: aiResult.reason,
                priority: 'high',
                template: aiResult.schema,
              }];
              validationErrors = aiResult.errors;
            } else {
              const fallback = buildFallbackSchema(item.pageName, slug, htmlTitle, '', isHomepage, baseUrl, pageCtx);
              const types = ((fallback['@graph'] as Record<string, unknown>[]) || []).map(n => n['@type']).filter(Boolean);
              suggestedSchemas = [{
                type: types.join(' + '),
                reason: `Basic schema with ${types.join(', ')}`,
                priority: 'medium',
                template: fallback,
              }];
              validationErrors = validateUnifiedSchema(fallback);
            }
          } else {
            const fallback = buildFallbackSchema(item.pageName, slug, htmlTitle, '', isHomepage, baseUrl, pageCtx);
            const types = ((fallback['@graph'] as Record<string, unknown>[]) || []).map(n => n['@type']).filter(Boolean);
            suggestedSchemas = [{
              type: types.join(' + '),
              reason: `Basic schema with ${types.join(', ')}`,
              priority: 'medium',
              template: fallback,
            }];
            validationErrors = validateUnifiedSchema(fallback);
          }

          return {
            pageId: `cms-${slug}`,
            pageTitle: item.pageName,
            slug,
            url: item.url,
            existingSchemas,
            existingSchemaJson: existingSchemaJson.length > 0 ? existingSchemaJson : undefined,
            suggestedSchemas,
            validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
          } as SchemaPageSuggestion;
        })
      );
      results.push(...chunkResults.filter(Boolean) as SchemaPageSuggestion[]);
      onProgress?.(results, false, `Processed ${Math.min(i + batch, cmsUrls.length)} of ${cmsUrls.length} CMS pages...`);
    }
  }

  // Sort: pages with validation errors last, homepage first
  results.sort((a, b) => {
    const aHome = a.slug === '' || a.slug === 'index' || a.slug === 'home' ? 0 : 1;
    const bHome = b.slug === '' || b.slug === 'index' || b.slug === 'home' ? 0 : 1;
    if (aHome !== bHome) return aHome - bHome;
    const aErr = (a.validationErrors?.length || 0) > 0 ? 1 : 0;
    const bErr = (b.validationErrors?.length || 0) > 0 ? 1 : 0;
    return aErr - bErr;
  });

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
      model: 'gpt-4.1-mini',
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
    try { JSON.parse(jsonStr); } catch {
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
