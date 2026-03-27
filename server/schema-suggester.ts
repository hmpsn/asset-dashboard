import { listPages, filterPublishedPages, discoverCmsUrls, buildStaticPathSet, getCollectionSchema, listCollections } from './webflow.js';
import { callOpenAI } from './openai-helpers.js';
import { resolvePagePath } from './helpers.js';
import { createLogger } from './logger.js';
import { saveSiteTemplate, getOrSeedSiteTemplate, getSchemaPlan } from './schema-store.js';
import { getBrief } from './content-brief.js';
import type { ContentBrief } from '../shared/types/content.ts';
import { buildPlanContextForPage } from './schema-plan.js';
import { getAncestorChain, getParentNode, getSiblingNodes, getChildNodes } from './site-architecture.js';

const log = createLogger('schema');

const WEBFLOW_API = 'https://api.webflow.com/v2';

function getToken(tokenOverride?: string): string | null {
  return tokenOverride || process.env.WEBFLOW_API_TOKEN || null;
}

export interface RichResultEligibility {
  type: string;
  eligible: boolean;
  feature: string;
  missingFields?: string[];
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
  homepage: { primary: ['Organization', 'WebSite'], secondary: ['SiteNavigationElement'] },
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

// ── Rich Results Eligibility ──────────────────────────────────────────────────

/** Google-supported rich result types and the fields they require. */
const RICH_RESULTS_ELIGIBLE: Record<string, { feature: string; required: string[] }> = {
  FAQPage:       { feature: 'FAQ accordion in search',        required: ['mainEntity'] },
  HowTo:         { feature: 'How-to steps in search',         required: ['name', 'step'] },
  VideoObject:   { feature: 'Video carousel',                 required: ['name', 'uploadDate', 'thumbnailUrl'] },
  Article:       { feature: 'Article rich result',            required: ['headline', 'datePublished', 'author', 'image'] },
  NewsArticle:   { feature: 'Article rich result',            required: ['headline', 'datePublished', 'author', 'image'] },
  BlogPosting:   { feature: 'Article rich result',            required: ['headline', 'datePublished', 'author', 'image'] },
  Product:       { feature: 'Product rich result',            required: ['name', 'offers'] },
  LocalBusiness: { feature: 'Local business panel',           required: ['name', 'address'] },
  Event:         { feature: 'Event listing',                  required: ['name', 'startDate', 'location'] },
  Recipe:        { feature: 'Recipe rich result',             required: ['name', 'image', 'recipeIngredient', 'recipeInstructions'] },
  JobPosting:    { feature: 'Job listing in search',          required: ['title', 'hiringOrganization', 'jobLocation', 'datePosted', 'description'] },
  BreadcrumbList: { feature: 'Breadcrumb trail in search',    required: ['itemListElement'] },
  Course:        { feature: 'Course info in search',          required: ['name', 'description', 'provider'] },
  Review:        { feature: 'Review rich result',             required: ['itemReviewed', 'reviewRating', 'author'] },
  ProfilePage:   { feature: 'Profile page in search',        required: ['mainEntity'] },
  MedicalOrganization: { feature: 'Medical business panel',  required: ['name', 'address'] },
  FinancialService:    { feature: 'Financial service panel',  required: ['name', 'address'] },
  Speakable:     { feature: 'Speakable for voice assistants', required: ['cssSelector'] },
};

/**
 * Check which schema types in a @graph qualify for Google Rich Results,
 * and what fields are missing for those that don't yet qualify.
 */
export function checkRichResultsEligibility(schema: Record<string, unknown>): RichResultEligibility[] {
  const graph = schema['@graph'] as Record<string, unknown>[] | undefined;
  if (!Array.isArray(graph)) return [];

  const results: RichResultEligibility[] = [];

  for (const node of graph) {
    const rawType = node['@type'];
    const types = Array.isArray(rawType) ? rawType as string[] : (rawType ? [rawType as string] : []);
    for (const type of types) {
      if (!type || !RICH_RESULTS_ELIGIBLE[type]) continue;

      const { feature, required } = RICH_RESULTS_ELIGIBLE[type];
      const missingFields = required.filter(field => {
        const val = node[field];
        if (val === undefined || val === null) return true;
        if (Array.isArray(val) && val.length === 0) return true;
        if (typeof val === 'string' && val.trim() === '') return true;
        return false;
      });

      results.push({
        type,
        feature,
        eligible: missingFields.length === 0,
        missingFields: missingFields.length > 0 ? missingFields : undefined,
      });
    }
  }

  return results;
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
  _businessProfile?: {  // Internal: verified business data — bypasses page-content verification checks
    phone?: string;
    email?: string;
    address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
    socialProfiles?: string[];
    openingHours?: string;
    foundedDate?: string;
    numberOfEmployees?: string;
  };
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
  Service: ['name', 'url'],
  SoftwareApplication: ['name', 'url'],
  Product: ['name'],
  Event: ['name', 'startDate', 'location'],
  HowTo: ['name', 'step'],
  Review: ['itemReviewed', 'author'],
  VideoObject: ['name', 'uploadDate', 'thumbnailUrl'],
  Person: ['name'],
};

// Recommended fields that improve rich result eligibility
const RECOMMENDED_FIELDS: Record<string, string[]> = {
  Organization: ['logo', 'sameAs', 'url'],
  Service: ['provider'],
  WebPage: ['isPartOf'],
  Article: ['publisher'],
  BlogPosting: ['publisher'],
  Product: ['offers', 'image'],
  LocalBusiness: ['telephone', 'openingHoursSpecification'],
  HowTo: ['description', 'totalTime', 'supply', 'tool', 'image'],
  VideoObject: ['description', 'duration', 'embedUrl', 'contentUrl'],
};

// Cross-reference rules: { type → field → expected target @type }
const CROSS_REF_RULES: Record<string, Record<string, string>> = {
  Service: { provider: 'Organization' },
  SoftwareApplication: { provider: 'Organization' },
  WebPage: { isPartOf: 'WebSite' },
  Article: { publisher: 'Organization' },
  BlogPosting: { publisher: 'Organization' },
  WebSite: { publisher: 'Organization' },
};

// Properties that are NOT valid Schema.org and commonly hallucinated by AI
const INVALID_PROPERTIES: Record<string, string[]> = {
  Organization: ['industry', 'founded', 'headquarters', 'employeeCount', 'products', 'services'],
  Service: ['features', 'benefits', 'pricing'],
  WebPage: ['keywords', 'category'],
  Person: ['title', 'company'],
};

// Phone number format: must look like a real number (digits, dashes, parens, spaces, +)
const PHONE_REGEX = /^\+?[\d\s().-]{7,20}$/;
function isValidPhone(val: string): boolean {
  const digits = val.replace(/\D/g, '');
  return PHONE_REGEX.test(val) && digits.length >= 7 && digits.length <= 15;
}

function validateGraphNode(node: Record<string, unknown>, allNodes: Record<string, unknown>[]): string[] {
  const errors: string[] = [];
  const type = node['@type'] as string;
  if (!type) { errors.push('Missing @type'); return errors; }

  // 1. Required fields
  const required = REQUIRED_FIELDS[type];
  if (required) {
    for (const field of required) {
      const val = node[field];
      if (val === undefined || val === null || val === '' || val === '[') {
        errors.push(`${type}: missing required field "${field}"`);
      }
      if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
        errors.push(`${type}: placeholder not filled for "${field}"`);
      }
    }
  }

  // 2. Recommended fields (warnings, not errors)
  const recommended = RECOMMENDED_FIELDS[type];
  if (recommended) {
    for (const field of recommended) {
      if (node[field] === undefined || node[field] === null) {
        errors.push(`${type}: recommended field "${field}" is missing (improves rich results)`);
      }
    }
  }

  // 3. Invalid properties (hallucinated by AI)
  const invalid = INVALID_PROPERTIES[type];
  if (invalid) {
    for (const field of invalid) {
      if (node[field] !== undefined) {
        errors.push(`${type}: "${field}" is not a valid Schema.org property — remove it`);
      }
    }
  }

  // 4. Cross-reference validation
  const crossRefs = CROSS_REF_RULES[type];
  if (crossRefs) {
    for (const [field, expectedType] of Object.entries(crossRefs)) {
      const val = node[field];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const ref = val as Record<string, unknown>;
        if (ref['@id']) {
          // Check if referenced node exists in @graph
          const target = allNodes.find(n => n['@id'] === ref['@id']);
          if (!target) {
            errors.push(`${type}.${field}: references "${ref['@id']}" but no matching node found in @graph`);
          }
        } else if (ref['@type'] && ref['@type'] !== expectedType) {
          errors.push(`${type}.${field}: expected @type "${expectedType}" but got "${ref['@type']}"`);
        }
      }
    }
  }

  // 5. Phone number format validation
  const telephone = node['telephone'] as string | undefined;
  if (telephone && typeof telephone === 'string') {
    if (!isValidPhone(telephone)) {
      errors.push(`${type}: "telephone" value "${telephone}" appears malformed — use E.164 format (+1234567890) or standard format`);
    }
  }

  // 6. Keyword-stuffed serviceType detection
  const serviceType = node['serviceType'];
  if (Array.isArray(serviceType) && serviceType.length > 3) {
    errors.push(`${type}: "serviceType" has ${serviceType.length} entries — keep to 1-3 concise types to avoid keyword stuffing`);
  }

  return errors;
}

function validateUnifiedSchema(schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!schema['@context']) errors.push('Missing @context');
  const graph = schema['@graph'] as Record<string, unknown>[];
  if (!Array.isArray(graph)) { errors.push('Missing @graph array'); return errors; }
  for (const node of graph) {
    errors.push(...validateGraphNode(node, graph));
  }
  return errors;
}

// Auto-fix: strip invalid properties and fix common AI hallucinations
function autoFixSchema(schema: Record<string, unknown>): void {
  const graph = schema['@graph'] as Record<string, unknown>[] | undefined;
  if (!Array.isArray(graph)) return;

  // Deduplicate Organization nodes — keep the first one with canonical @id (/#organization)
  const orgNodes = graph.filter(n => n['@type'] === 'Organization');
  if (orgNodes.length > 1) {
    const canonical = orgNodes.find(n => String(n['@id'] || '').endsWith('/#organization')) || orgNodes[0];
    for (let i = graph.length - 1; i >= 0; i--) {
      if (graph[i]['@type'] === 'Organization' && graph[i] !== canonical) {
        log.info(`Auto-fix: removed duplicate Organization node with @id "${graph[i]['@id']}"`);
        graph.splice(i, 1);
      }
    }
  }

  for (const node of graph) {
    const type = node['@type'] as string;
    if (!type) continue;

    // Strip invalid properties for this type
    const invalid = INVALID_PROPERTIES[type];
    if (invalid) {
      for (const field of invalid) {
        if (node[field] !== undefined) {
          log.info(`Auto-fix: removed invalid "${field}" from ${type}`);
          delete node[field];
        }
      }
    }

    // Fix malformed telephone — strip if clearly invalid
    const tel = node['telephone'] as string | undefined;
    if (tel && typeof tel === 'string' && !isValidPhone(tel)) {
      log.info(`Auto-fix: removed malformed telephone "${tel}" from ${type}`);
      delete node['telephone'];
    }

    // Trim keyword-stuffed serviceType arrays down to 3
    const st = node['serviceType'];
    if (Array.isArray(st) && st.length > 3) {
      log.info(`Auto-fix: trimmed serviceType from ${st.length} to 3 entries on ${type}`);
      node['serviceType'] = st.slice(0, 3);
    }

    // Normalize Service/SoftwareApplication @id to use canonical product URL
    // If the node has a url field different from the @id base, fix @id to match
    if ((type === 'Service' || type === 'SoftwareApplication') && node['url'] && node['@id']) {
      const nodeUrl = node['url'] as string;
      const nodeId = node['@id'] as string;
      const idBase = nodeId.replace(/#.*$/, '');
      if (idBase !== nodeUrl && nodeUrl !== idBase) {
        const suffix = nodeId.includes('#') ? nodeId.replace(/^[^#]+/, '') : '#service';
        const newId = `${nodeUrl}${suffix}`;
        log.info(`Auto-fix: normalized ${type} @id from "${nodeId}" to "${newId}" (canonical url: ${nodeUrl})`);
        // Update all @id references in the graph
        for (const other of graph) {
          for (const [, val] of Object.entries(other)) {
            if (val && typeof val === 'object' && (val as Record<string, unknown>)['@id'] === nodeId) {
              (val as Record<string, unknown>)['@id'] = newId;
            }
          }
        }
        node['@id'] = newId;
      }
    }

    // Auto-fix BreadcrumbList: truncate long item names
    if (type === 'BreadcrumbList') {
      const items = node['itemListElement'] as Record<string, unknown>[] | undefined;
      if (Array.isArray(items)) {
        for (const item of items) {
          let name = item['name'] as string | undefined;
          if (!name || typeof name !== 'string') continue;
          // Strip "| Brand Name" or "— Brand Name" suffixes
          name = name.replace(/\s*[|–—-]\s*[^|–—-]+$/, '').trim();
          // If still over 50 chars, truncate at last word boundary
          if (name.length > 50) {
            const truncated = name.slice(0, 50).replace(/\s+\S*$/, '').trim();
            name = truncated || name.slice(0, 50);
          }
          item['name'] = name;
        }
      }
    }
  }
}

// Post-processing: inject cross-references the AI consistently omits
function injectCrossReferences(schema: Record<string, unknown>, siteUrl: string, companyName?: string, ctx?: SchemaContext): void {
  const graph = schema['@graph'] as Record<string, unknown>[] | undefined;
  if (!Array.isArray(graph)) return;

  const orgId = `${siteUrl}/#organization`;
  const websiteId = `${siteUrl}/#website`;

  // Ensure Organization node exists (referenced by WebSite.publisher, Service.provider, etc.)
  const hasOrg = graph.some(n => n['@type'] === 'Organization');
  if (!hasOrg) {
    graph.unshift({
      '@type': 'Organization',
      '@id': orgId,
      'name': companyName || new URL(siteUrl).hostname.replace('www.', ''),
      'url': siteUrl,
    });
  }

  // Ensure WebSite node exists (referenced by WebPage.isPartOf)
  const hasWebSite = graph.some(n => n['@type'] === 'WebSite');
  if (!hasWebSite) {
    graph.splice(hasOrg ? 1 : 1, 0, {
      '@type': 'WebSite',
      '@id': websiteId,
      'url': siteUrl,
      'name': companyName || new URL(siteUrl).hostname.replace('www.', ''),
      'publisher': { '@id': orgId },
    });
  }

  // Identify the "primary entity" — the first non-structural node for mainEntity
  const structuralTypes = new Set(['Organization', 'WebSite', 'WebPage', 'BreadcrumbList']);
  const primaryEntity = graph.find(n => {
    const t = n['@type'] as string;
    return t && !structuralTypes.has(t) && n['@id'];
  });

  for (const node of graph) {
    const type = node['@type'] as string;
    if (!type) continue;

    // WebSite → publisher → Organization
    if (type === 'WebSite' && !node['publisher']) {
      node['publisher'] = { '@id': orgId };
    }

    // WebPage → isPartOf → WebSite
    if (type === 'WebPage' && !node['isPartOf']) {
      node['isPartOf'] = { '@id': websiteId };
    }

    // WebPage → mainEntity → primary entity (SoftwareApplication, Service, etc.)
    if (type === 'WebPage' && !node['mainEntity'] && primaryEntity) {
      node['mainEntity'] = { '@id': primaryEntity['@id'] };
    }

    // Service / SoftwareApplication → provider → Organization + ensure url
    if (type === 'Service' || type === 'SoftwareApplication') {
      if (!node['provider']) {
        node['provider'] = { '@id': orgId };
      }
      // Auto-fill url from WebPage if missing
      if (!node['url']) {
        const webPage = graph.find(n => n['@type'] === 'WebPage');
        if (webPage?.['url']) {
          node['url'] = webPage['url'];
        }
      }
    }

    // Article / BlogPosting → publisher → Organization
    if ((type === 'Article' || type === 'BlogPosting') && !node['publisher']) {
      node['publisher'] = { '@id': orgId };
    }
  }

  // Ensure BreadcrumbList exists
  const hasBreadcrumb = graph.some(n => n['@type'] === 'BreadcrumbList');
  if (!hasBreadcrumb) {
    const webPage = graph.find(n => n['@type'] === 'WebPage') as Record<string, unknown> | undefined;
    if (webPage) {
      const pageUrl = (webPage['url'] as string) || siteUrl;
      try {
        const parsed = new URL(pageUrl);
        const pagePath = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/$/, '');

        // Try architecture-tree-aware breadcrumbs first
        const tree = ctx?._architectureTree;
        const ancestors = tree ? getAncestorChain(tree, pagePath) : [];

        if (ancestors.length >= 2) {
          // Architecture tree available — build full breadcrumb chain from ancestor nodes
          const items: Record<string, unknown>[] = ancestors.map((node, i) => ({
            '@type': 'ListItem',
            'position': i + 1,
            'name': node.depth === 0 ? 'Home' : node.name,
            'item': node.depth === 0 ? `${siteUrl}/` : `${siteUrl}${node.path}`,
          }));
          graph.push({
            '@type': 'BreadcrumbList',
            '@id': `${pageUrl}/#breadcrumb`,
            'itemListElement': items,
          });
          log.info({ pagePath, depth: ancestors.length }, 'Built breadcrumb from architecture tree');
        } else {
          // Fallback: naive URL-segment breadcrumb (Home → Page)
          const pathParts = parsed.pathname.split('/').filter(Boolean);
          const items: Record<string, unknown>[] = [
            { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': `${siteUrl}/` },
          ];
          if (pathParts.length > 0) {
            const pageName = (webPage['name'] as string || pathParts[pathParts.length - 1])
              .replace(/\s*[|–-]\s*.+$/, '');
            items.push({
              '@type': 'ListItem',
              'position': 2,
              'name': pageName,
              'item': pageUrl,
            });
          }
          graph.push({
            '@type': 'BreadcrumbList',
            '@id': `${pageUrl}/#breadcrumb`,
            'itemListElement': items,
          });
        }
      } catch { /* skip if URL parsing fails */ }
    }
  }

  // Auto-generate SiteNavigationElement for homepage when architecture tree is available
  const tree = ctx?._architectureTree;
  if (tree) {
    const webPage = graph.find(n => n['@type'] === 'WebPage') as Record<string, unknown> | undefined;
    const pageUrl = (webPage?.['url'] as string) || siteUrl;
    const isHomepage = pageUrl === siteUrl || pageUrl === `${siteUrl}/` || new URL(pageUrl).pathname === '/';
    const hasNav = graph.some(n => n['@type'] === 'SiteNavigationElement');

    if (isHomepage && !hasNav && tree.children.length > 0) {
      const navItems = tree.children
        .filter(n => n.source === 'existing' && n.hasContent)
        .slice(0, 10) // Cap at 10 top-level nav items
        .map((n, i) => ({
          '@type': 'SiteNavigationElement',
          'position': i + 1,
          'name': n.name,
          'url': `${siteUrl}${n.path}`,
        }));

      if (navItems.length > 0) {
        graph.push({
          '@type': 'SiteNavigationElement',
          '@id': `${siteUrl}/#navigation`,
          'name': 'Main Navigation',
          'hasPart': navItems,
        });
        log.info({ navCount: navItems.length }, 'Injected SiteNavigationElement from architecture tree');
      }
    }
  }

  // D3: Hub page → CollectionPage/ItemList auto-suggest
  // When a page has 2+ children in the architecture tree, inject CollectionPage schema
  const hubTree = ctx?._architectureTree;
  if (hubTree) {
    const webPage = graph.find(n => n['@type'] === 'WebPage') as Record<string, unknown> | undefined;
    const pageUrl = (webPage?.['url'] as string) || siteUrl;
    try {
      const pagePath = new URL(pageUrl).pathname.replace(/\/$/, '') || '/';
      const children = getChildNodes(hubTree, pagePath)
        .filter(c => c.source === 'existing');  // Only existing pages, not planned
      if (children.length >= 2) {
        const hasCollection = graph.some(n => n['@type'] === 'CollectionPage' || n['@type'] === 'ItemList');
        if (!hasCollection) {
          const webPageName = (webPage?.['name'] as string) || 'Collection';
          graph.push({
            '@type': 'CollectionPage',
            '@id': `${pageUrl}/#collection`,
            'name': webPageName,
            'hasPart': children.map((child, i) => ({
              '@type': 'ListItem',
              'position': i + 1,
              'url': `${siteUrl}${child.path}`,
              'name': child.name,
            })),
          });
          log.info({ pagePath, childCount: children.length }, 'Injected CollectionPage for hub page');
        }
      }
    } catch { /* skip if URL parsing fails */ }
  }

  // D5: Sibling/Parent-Child Relationship Enrichment
  // When architecture tree is available, add isPartOf (→ parent page), relatedLink (→ siblings),
  // and hasPart (→ children) to WebPage nodes.
  const relTree = ctx?._architectureTree;
  if (relTree) {
    const webPage = graph.find(n => n['@type'] === 'WebPage') as Record<string, unknown> | undefined;
    if (webPage) {
      const pageUrl = (webPage['url'] as string) || siteUrl;
      try {
        const pagePath = new URL(pageUrl).pathname.replace(/\/$/, '') || '/';

        // isPartOf → actual parent page (not just WebSite)
        const parentNode = getParentNode(relTree, pagePath);
        if (parentNode && parentNode.depth > 0 && parentNode.hasContent) {
          // Override the generic WebSite isPartOf with the actual parent page
          webPage['isPartOf'] = {
            '@type': 'WebPage',
            '@id': `${siteUrl}${parentNode.path}`,
            'name': parentNode.name,
            'url': `${siteUrl}${parentNode.path}`,
          };
          log.info({ pagePath, parent: parentNode.path }, 'Enriched isPartOf with parent page');
        }

        // relatedLink → sibling pages (max 5 to avoid bloat)
        if (!webPage['relatedLink']) {
          const siblings = getSiblingNodes(relTree, pagePath)
            .filter(s => s.source === 'existing')
            .slice(0, 5);
          if (siblings.length > 0) {
            webPage['relatedLink'] = siblings.map(s => `${siteUrl}${s.path}`);
            log.info({ pagePath, siblingCount: siblings.length }, 'Enriched relatedLink with siblings');
          }
        }

        // hasPart → child pages
        if (!webPage['hasPart']) {
          const children = getChildNodes(relTree, pagePath)
            .filter(c => c.source === 'existing');
          if (children.length > 0) {
            webPage['hasPart'] = children.map(c => ({
              '@type': 'WebPage',
              '@id': `${siteUrl}${c.path}`,
              'name': c.name,
              'url': `${siteUrl}${c.path}`,
            }));
            log.info({ pagePath, childCount: children.length }, 'Enriched hasPart with child pages');
          }
        }
      } catch { /* skip if URL parsing fails */ }
    }
  }
}

// Content verification: cross-check schema values against actual page content
function verifySchemaContent(schema: Record<string, unknown>, pageText: string, html: string | null, ctx?: SchemaContext): string[] {
  const graph = schema['@graph'] as Record<string, unknown>[] | undefined;
  if (!Array.isArray(graph) || !pageText) return [];

  const stripped: string[] = [];
  const lowerText = pageText.toLowerCase();
  // Also check the raw HTML (lowered) for things like mailto: links, tel: links
  const lowerHtml = (html || '').toLowerCase();

  // Business profile trusted values — bypass page-content checks for these
  const bp = ctx?._businessProfile;
  const bpEmail = bp?.email?.toLowerCase();
  const bpPhone = bp?.phone ? bp.phone.replace(/\D/g, '') : undefined;
  const bpCity = bp?.address?.city?.toLowerCase();
  const bpStreet = bp?.address?.street?.toLowerCase();
  const bpHasHours = !!bp?.openingHours;
  const bpSocialProfiles = new Set((bp?.socialProfiles || []).map(u => u.toLowerCase()));

  for (const node of graph) {
    const type = node['@type'] as string;
    if (!type) continue;

    // Check email — must appear in visible text or as mailto: link
    // Exception: if business profile provides this email, skip the content check
    const email = node['email'] as string | undefined;
    if (email && typeof email === 'string') {
      const emailLower = email.toLowerCase();
      const trustedByProfile = bpEmail && emailLower === bpEmail;
      if (!trustedByProfile && !lowerText.includes(emailLower) && !lowerHtml.includes(`mailto:${emailLower}`)) {
        stripped.push(`${type}: removed hallucinated email "${email}" (not found in page content)`);
        delete node['email'];
      }
    }

    // Check telephone — must appear in visible text or as tel: link
    // Exception: if business profile provides a phone, bypass the check for matching digits
    const tel = node['telephone'];
    if (tel) {
      const phones = Array.isArray(tel) ? tel : [tel];
      const verified = phones.filter((p: string) => {
        const digits = String(p).replace(/\D/g, '');
        if (bpPhone && digits === bpPhone) return true;  // trusted by business profile
        return lowerText.includes(digits) || lowerText.includes(String(p)) || lowerHtml.includes(`tel:${digits}`) || lowerHtml.includes(`tel:+${digits}`);
      });
      if (verified.length === 0) {
        stripped.push(`${type}: removed hallucinated telephone (not found in page content)`);
        delete node['telephone'];
      } else if (verified.length < phones.length) {
        stripped.push(`${type}: removed ${phones.length - verified.length} unverified phone number(s)`);
        node['telephone'] = verified.length === 1 ? verified[0] : verified;
      }
    }

    // Check address — if PostalAddress exists, verify street/city appear in content
    // Exception: if business profile provides matching address, bypass the content check
    const address = node['address'] as Record<string, unknown> | undefined;
    if (address && typeof address === 'object' && address['@type'] === 'PostalAddress') {
      const street = (address['streetAddress'] as string || '').toLowerCase();
      const city = (address['addressLocality'] as string || '').toLowerCase();
      const trustedByProfile = (bpCity && city === bpCity) || (bpStreet && street === bpStreet);
      if (!trustedByProfile && street && !lowerText.includes(street) && city && !lowerText.includes(city)) {
        stripped.push(`${type}: removed hallucinated address (street/city not found in page content)`);
        delete node['address'];
      }
    }

    // Check openingHoursSpecification — remove if no hours pattern found in content
    // Exception: if business profile provides opening hours, trust it
    if (node['openingHoursSpecification'] && !bpHasHours && !lowerText.match(/\d{1,2}:\d{2}\s*(?:am|pm|–|-|to)/i) && !lowerText.match(/(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)) {
      stripped.push(`${type}: removed hallucinated openingHoursSpecification (no hours found in page content)`);
      delete node['openingHoursSpecification'];
    }

    // Check geo coordinates — remove if no coordinate-like numbers in content
    const geo = node['geo'] as Record<string, unknown> | undefined;
    if (geo && typeof geo === 'object' && geo['@type'] === 'GeoCoordinates') {
      const lat = String(geo['latitude'] || '');
      const lon = String(geo['longitude'] || '');
      if (lat && !lowerText.includes(lat) && lon && !lowerText.includes(lon)) {
        stripped.push(`${type}: removed hallucinated geo coordinates (not found in page content)`);
        delete node['geo'];
      }
    }

    // Check FAQPage — require REAL FAQ structural patterns on the page
    // A section heading like "What's under the hood?" is NOT an FAQ — it's a rhetorical heading.
    // We need evidence of a dedicated FAQ section before allowing FAQPage schema.
    if (type === 'FAQPage') {
      const hasFaqStructure =
        // Dedicated FAQ heading
        /(?:faq|frequently\s+asked|common\s+questions|questions?\s+(?:&|and)\s+answers?)/i.test(lowerText) ||
        // Accordion / collapsible markup patterns
        lowerHtml.includes('aria-expanded') ||
        lowerHtml.includes('<details') ||
        lowerHtml.includes('accordion') ||
        lowerHtml.includes('faq-item') ||
        lowerHtml.includes('faq_item') ||
        lowerHtml.includes('faq-question') ||
        lowerHtml.includes('faq_question');

      if (!hasFaqStructure) {
        const mainEntity = node['mainEntity'] as Record<string, unknown>[] | undefined;
        const qCount = Array.isArray(mainEntity) ? mainEntity.length : 0;
        stripped.push(`FAQPage: removed — no FAQ section structure found on page (${qCount} question(s) were likely derived from section headings, not a real FAQ)`);
        node['_remove'] = true;
      } else {
        // Has FAQ structure — still verify individual questions appear in content
        const mainEntity = node['mainEntity'] as Record<string, unknown>[] | undefined;
        if (Array.isArray(mainEntity)) {
          const verified = mainEntity.filter((q: Record<string, unknown>) => {
            const name = (q['name'] as string || '').toLowerCase().trim();
            return name.length > 5 && (lowerText.includes(name) || lowerHtml.includes(name));
          });
          if (verified.length === 0) {
            stripped.push(`FAQPage: removed — none of the ${mainEntity.length} question(s) found in page content`);
            node['_remove'] = true;
          } else if (verified.length < mainEntity.length) {
            stripped.push(`FAQPage: removed ${mainEntity.length - verified.length} hallucinated question(s) not found in page content`);
            node['mainEntity'] = verified;
          }
        }
      }
    }

    // Check HowTo steps — verify step names exist in page text; strip hallucinated steps
    if (type === 'HowTo') {
      const steps = node['step'] as Record<string, unknown>[] | undefined;
      if (Array.isArray(steps) && steps.length > 0) {
        const verified = steps.filter((step: Record<string, unknown>) => {
          const name = (step['name'] as string || '').toLowerCase().trim();
          const text = (step['text'] as string || '').toLowerCase().trim();
          return (name.length > 3 && lowerText.includes(name)) || (text.length > 10 && lowerText.includes(text.slice(0, 30)));
        });
        if (verified.length === 0) {
          stripped.push(`HowTo: removed — none of the ${steps.length} step(s) found in page content`);
          node['_remove'] = true;
        } else if (verified.length < steps.length) {
          stripped.push(`HowTo: removed ${steps.length - verified.length} hallucinated step(s) not found in page content`);
          node['step'] = verified;
        }
      }
    }

    // Check VideoObject — verify thumbnailUrl and embedUrl/contentUrl exist in HTML
    if (type === 'VideoObject') {
      const thumbnailUrl = node['thumbnailUrl'] as string | undefined;
      const embedUrl = node['embedUrl'] as string | undefined;
      const contentUrl = node['contentUrl'] as string | undefined;
      if (thumbnailUrl && !lowerHtml.includes(thumbnailUrl.toLowerCase())) {
        stripped.push(`VideoObject: removed hallucinated thumbnailUrl "${thumbnailUrl}" (not found in page HTML)`);
        delete node['thumbnailUrl'];
      }
      if (embedUrl && !lowerHtml.includes(embedUrl.toLowerCase().split('?')[0])) {
        stripped.push(`VideoObject: removed unverified embedUrl "${embedUrl}" (not found in page HTML)`);
        delete node['embedUrl'];
      }
      if (contentUrl && !lowerHtml.includes(contentUrl.toLowerCase())) {
        stripped.push(`VideoObject: removed unverified contentUrl (not found in page HTML)`);
        delete node['contentUrl'];
      }
      // If thumbnailUrl was stripped, remove the whole VideoObject since it's a required field
      if (!node['thumbnailUrl']) {
        stripped.push('VideoObject: removed — thumbnailUrl is required and could not be verified from page content');
        node['_remove'] = true;
      }
    }

    // Check sameAs URLs — filter to only URLs that appear in the HTML or business profile
    const sameAs = node['sameAs'] as string[] | undefined;
    if (Array.isArray(sameAs)) {
      const verified = sameAs.filter(url => {
        const urlLower = url.toLowerCase();
        return lowerHtml.includes(urlLower) || bpSocialProfiles.has(urlLower);
      });
      if (verified.length < sameAs.length) {
        const removed = sameAs.length - verified.length;
        stripped.push(`${type}: removed ${removed} hallucinated sameAs URL(s) (not found in page HTML or business profile)`);
        if (verified.length === 0) {
          delete node['sameAs'];
        } else {
          node['sameAs'] = verified;
        }
      }
    }
  }

  return stripped;
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
  // Strip scripts, styles, and HTML tags for clean text extraction (emails + phones)
  const visibleText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  const emails = (visibleText.match(/[\w.-]+@[\w.-]+\.\w+/g) || [])
    .filter(e => /\.(com|org|net|edu|gov|io|co|us|uk|ca|au)$/i.test(e))
    .filter(e => !/[@.](?:npm|pkg|bower|components?|modules?|packages?|plugins?|bundle)/i.test(e))
    .filter(e => !/\d+\.\d+\.\d+/.test(e))
    .slice(0, 3);
  const phones = (visibleText.match(/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || []).slice(0, 2);
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

  // Extract HowTo steps: <ol><li> items, "Step N:" headings, numbered headings
  const stepTexts = new Set<string>();
  // <ol><li> pattern
  const olMatch = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/gi);
  if (olMatch) {
    for (const ol of olMatch) {
      const lis = ol.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
      for (const li of lis) {
        const text = li.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 10 && text.length < 200) stepTexts.add(text);
      }
    }
  }
  // "Step N:" heading patterns
  const stepHeadings = html.match(/<h[2-4][^>]*>[^<]*(?:step\s+\d+|^\d+\.)[^<]*/gi) || [];
  for (const h of stepHeadings) {
    const text = h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > 5 && text.length < 200) stepTexts.add(text);
  }
  const steps = [...stepTexts].slice(0, 15);

  // Extract video URLs: YouTube/Vimeo iframes, <video src>
  const videoUrls: string[] = [];
  const iframeSrcs = html.match(/(?:src)=["']([^"']*(?:youtube\.com\/embed|youtube-nocookie\.com\/embed|vimeo\.com\/video|player\.vimeo\.com)[^"']*)["']/gi) || [];
  for (const src of iframeSrcs) {
    const m = src.match(/src=["']([^"']+)["']/i);
    if (m) videoUrls.push(m[1]);
  }
  const videoSrcs = html.match(/<video[^>]+src=["']([^"']+)["']/gi) || [];
  for (const v of videoSrcs) {
    const m = v.match(/src=["']([^"']+)["']/i);
    if (m) videoUrls.push(m[1]);
  }
  const uniqueVideoUrls = [...new Set(videoUrls)].slice(0, 5);

  return { emails, phones, images, questions, author, publishDate, steps, videoUrls: uniqueVideoUrls };
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

// Page-type-specific prompt instructions for tailored schema generation
function getPageTypeInstructions(pageType: SchemaPageType | undefined, siteUrl: string): string {
  if (!pageType || pageType === 'auto') return '';
  const instructions: Record<string, string> = {
    homepage: `PAGE TYPE INSTRUCTIONS (Homepage):
- MUST include WebSite node with "@id": "${siteUrl}/#website", "publisher": {"@id": "${siteUrl}/#organization"}, and potentialAction ONLY if a real search URL exists
- MUST include Organization with: name, url, logo, description, knowsAbout (3-5 concise terms), sameAs (ONLY from page content)
- For SaaS/platform sites: use SoftwareApplication (not Service) as the primary product node with applicationCategory, operatingSystem "Web", provider → Organization. Do NOT create separate Service nodes for product features — describe features in the SoftwareApplication description or featureList.
- For service businesses: use ONE Service node for the primary service offering, or 2-3 max if the page clearly presents distinct service lines with separate URLs
- If testimonials/reviews appear, include them as Review nodes on the Organization
- Include BreadcrumbList with just Home
- WebPage MUST include "isPartOf": {"@id": "${siteUrl}/#website"} and "mainEntity": {"@id": "${siteUrl}/#organization"} (or reference the primary SoftwareApplication/Service)`,

    pillar: `PAGE TYPE INSTRUCTIONS (Pillar / Product Page):
- This is the canonical page for a product or service — it OWNS the primary SoftwareApplication or Service entity
- For SaaS/platform: MUST include SoftwareApplication as mainEntity with: name, description, url, applicationCategory, operatingSystem "Web", provider → Organization, featureList
- For service businesses: MUST include Service as mainEntity with: name, description, serviceType (1-3 concise types), provider → Organization, url, areaServed (if geographic)
- If the page describes multiple sub-services, include each as its own Service node with provider → Organization
- Include "hasOfferCatalog" if pricing tiers or packages are listed; include Offer node if pricing is visible
- Include "audience": {"@type": "Audience", "audienceType": "..."} if the target audience is identifiable
- Include "significantLink" array listing URLs to key subtopic/child pages found in the content
- Include BreadcrumbList: Home → [Category] → Product/Service Name
- Include "speakable" on WebPage targeting the introductory paragraph
- Do NOT create separate entities for features of the same product — use featureList or description instead
- WebPage.mainEntity should reference the primary product/service node`,

    service: `PAGE TYPE INSTRUCTIONS (Service Page):
- MUST include a Service node as mainEntity with: name, description, serviceType (1-3 concise types), provider \u2192 Organization, url, areaServed (if geographic)
- If the page describes multiple sub-services, include each as its own Service node with provider \u2192 Organization
- Include "audience": {"@type": "Audience", "audienceType": "..."} if the target audience is identifiable
- Include "hasOfferCatalog" if pricing tiers or packages are listed
- If there's a clear CTA or pricing, include an Offer node
- BreadcrumbList: Home \u2192 [Parent Category if applicable] \u2192 Service Name
- WebPage.mainEntity should reference the primary Service node`,

    audience: `PAGE TYPE INSTRUCTIONS (Audience / Persona Page):
- This page targets a specific audience segment (e.g. "For Developers", "For Enterprise")
- Use WebPage with "audience": {"@type": "Audience", "audienceType": "[specific audience]"}
- Reference the canonical product entity via "about": {"@id": "..."} — do NOT create your own Service or SoftwareApplication node
- Include "about" on WebPage describing who this audience is and what problems are addressed
- If the page links to multiple product features, use "significantLink" to reference them — but do NOT create separate Service nodes
- BreadcrumbList: Home → [Solutions/For] → Audience Name`,

    blog: `PAGE TYPE INSTRUCTIONS (Blog Post / Article):
- MUST include Article or BlogPosting as mainEntity with: headline, author (Person with name + credentials if found), datePublished, dateModified, image, publisher → Organization
- If medical/health content, add "reviewedBy" Person with credentials if a reviewer is mentioned
- Include "wordCount" if determinable from content length
- Include "articleSection" and "about" based on the topic
- If the post has a clear Q&A format, also include FAQPage
- BreadcrumbList: Home → Blog → Post Title
- Include "speakable" targeting the article summary/intro`,

    about: `PAGE TYPE INSTRUCTIONS (About / Team Page):
- Focus on enriching the Organization node with: name, description, foundingDate (if mentioned), founders (Person nodes), numberOfEmployees, knowsAbout, award, slogan
- If team members are listed, include each as a Person node with: name, jobTitle, image, sameAs (LinkedIn etc. from page), worksFor → Organization
- If company history/timeline is present, capture key facts in Organization.description
- BreadcrumbList: Home → About
- WebPage.mainEntity should reference the Organization node`,

    contact: `PAGE TYPE INSTRUCTIONS (Contact Page):
- Include ContactPage as the WebPage @type (use "@type": ["WebPage", "ContactPage"])
- MUST include ContactPoint on Organization with: contactType, telephone, email, areaServed, availableLanguage — ONLY from page content
- If a physical address is shown, include PostalAddress
- If a contact form exists, note it in WebPage description but don't fabricate form URLs
- If multiple departments/contact methods are listed, include each as a separate ContactPoint
- BreadcrumbList: Home → Contact`,

    location: `PAGE TYPE INSTRUCTIONS (Location Page):
- MUST include LocalBusiness (or more specific subtype like Dentist, Restaurant, Store) with: name, address (PostalAddress), telephone, openingHoursSpecification, geo (GeoCoordinates) — ONLY from page content
- Include "parentOrganization": {"@id": "${siteUrl}/#organization"} to link to the parent brand
- If multiple locations are listed, include each as its own LocalBusiness node
- Include "hasMap" if a Google Maps link/embed is present
- Include "image" of the location if visible
- BreadcrumbList: Home → Locations → [Location Name]`,

    product: `PAGE TYPE INSTRUCTIONS (Product Page):
- MUST include Product as mainEntity with: name, description, image, sku/gtin (if shown), brand → Organization
- Include Offer with: price, priceCurrency, availability, url — ONLY from page content. Use schema.org availability enums (InStock, OutOfStock, PreOrder)
- If reviews/ratings are shown, include AggregateRating and/or individual Review nodes
- Include "category" if the product category is identifiable
- If multiple variants exist, include each as a separate Offer within "offers" array
- BreadcrumbList: Home → [Category] → Product Name`,

    'lead-gen': `PAGE TYPE INSTRUCTIONS (Lead-Gen / Conversion Page):
- This is a conversion-focused page (/demo, /contact, /pricing, /signup, /get-started)
- Use ONLY WebPage + BreadcrumbList — no Service, SoftwareApplication, or product entity nodes
- Include WebPage with "significantLink" pointing to the primary CTA destination if identifiable
- Include "speakable" targeting the main headline and value proposition
- If testimonials/social proof appear, include as Review nodes on the WebPage
- If it is an event landing page, include Event with startDate, location, offers
- BreadcrumbList: Home → [Category] → Page Title
- Keep schema minimal — this page should NOT own or duplicate any product entities`,

    faq: `PAGE TYPE INSTRUCTIONS (FAQ Page):
- MUST include FAQPage as mainEntity with "mainEntity" array of Question nodes
- Each Question MUST have: "name" (the question text), "acceptedAnswer" with "@type": "Answer" and "text" (the answer)
- Extract ALL Q&A pairs from the page content — look for headings ending in ?, <details>/<summary> elements, accordion patterns, definition lists
- Include EVERY question found, not just the first few
- Answers should be the full text, not truncated
- BreadcrumbList: Home → [Category] → FAQ
- Also include the relevant parent entity (Organization, Service, or Product) that the FAQs are about`,

    'case-study': `PAGE TYPE INSTRUCTIONS (Case Study):
- Use Article with "@type": ["Article", "Report"] or just Article as mainEntity
- Include: headline, author (Person), datePublished, publisher → Organization
- Include "about" describing the client/project (use Organization or Thing for the subject)
- If measurable results are mentioned (e.g. "40% increase in traffic"), capture in the description
- If the case study includes testimonials from the client, include as Review with author
- BreadcrumbList: Home → Case Studies → [Client/Project Name]
- Include "speakable" targeting the results summary`,

    partnership: `PAGE TYPE INSTRUCTIONS (Partnership Page):
- This page describes a partnership or integration with another company/product
- Use WebPage with "mentions": {"@id": "..."} referencing the canonical product entity — do NOT create your own Service or SoftwareApplication node
- If the partner company is described, include an Organization node for them (separate from the site's main Organization)
- BreadcrumbList: Home → [Integrations/Partners] → Partner Name`,

    comparison: `PAGE TYPE INSTRUCTIONS (Comparison Page):
- This page compares the site's product against competitors (e.g. /vs-competitor, /alternative-to-X)
- Use WebPage with "about": {"@id": "..."} referencing the canonical product entity — do NOT create a duplicate Service/SoftwareApplication
- Include "mentions" for competitor products if named, using minimal Thing or SoftwareApplication nodes with just name + url
- BreadcrumbList: Home → [Comparisons] → Page Title`,

    author: `PAGE TYPE INSTRUCTIONS (Author Profile):
- MUST include Person as mainEntity with: name, jobTitle, description, image, sameAs (LinkedIn, Twitter, personal site from page content)
- Include ProfilePage as WebPage @type (use "@type": ["WebPage", "ProfilePage"]) with "mainEntity": {"@id": "#person"}
- If expertise areas/specialties are mentioned, include "knowsAbout" array with specific topics
- If publications/works are listed, include "hasOccupation" with CreativeWork nodes or use "creator" relationships
- If this author works for the company, include "worksFor": {"@id": "${siteUrl}/#organization"}
- BreadcrumbList: Home → [Team/About] → Author Name`,

    howto: `PAGE TYPE INSTRUCTIONS (How-To / Tutorial):
- MUST include HowTo as mainEntity with: name (the tutorial title), description, step (array of HowToStep)
- Each HowToStep MUST have: "@type": "HowToStep", "name" (step headline), "text" (detailed instructions)
- Extract steps from NUMBERED LISTS (<ol><li>) or "Step N:" headings ONLY — do NOT fabricate steps from paragraphs
- ONLY include steps whose text actually appears in the page content
- If totalTime is mentioned (e.g. "takes 30 minutes"), include as ISO 8601 duration: "PT30M"
- If supplies or tools are listed, include "supply": [{"@type": "HowToSupply", "name": "..."}] and "tool": [{"@type": "HowToTool", "name": "..."}]
- If a featured image exists, include "image" on HowTo
- If the tutorial also has article-style content, include Article as a secondary node
- BreadcrumbList: Home → [Category] → Tutorial Title
- WebPage.mainEntity should reference the HowTo node`,

    video: `PAGE TYPE INSTRUCTIONS (Video Page):
- MUST include VideoObject as mainEntity with: name, description, uploadDate (ISO 8601), thumbnailUrl
- uploadDate MUST be a real date from page content — do NOT fabricate; if not found, omit VideoObject entirely
- thumbnailUrl MUST be a real image URL from page content — do NOT fabricate
- If a YouTube or Vimeo embed is detected, include "embedUrl" with the embed URL
- If a direct video file URL is found, include "contentUrl"
- If transcript text is present, include "transcript" (max 500 chars)
- If duration is mentioned (e.g. "10:30"), convert to ISO 8601 duration: "PT10M30S"
- If the page also has article content, include Article as a secondary node alongside VideoObject
- BreadcrumbList: Home → [Category] → Video Title
- WebPage.mainEntity should reference the VideoObject node`,

    'job-posting': `PAGE TYPE INSTRUCTIONS (Job Posting):
- MUST include JobPosting as mainEntity with: title, datePosted (ISO 8601), description, hiringOrganization → Organization
- Include validThrough (expiry date) if mentioned
- Include employmentType (FULL_TIME, PART_TIME, CONTRACT, etc.) if specified
- Include jobLocation with Place + PostalAddress if a work location is given
- Include baseSalary with MonetaryAmount if salary/compensation is mentioned
- Include qualifications, skills, educationRequirements if listed
- BreadcrumbList: Home → Careers → Job Title`,

    course: `PAGE TYPE INSTRUCTIONS (Course / Training):
- MUST include Course as mainEntity with: name, description, provider → Organization
- If schedule/dates are provided, include CourseInstance with: startDate, endDate, courseMode (online/onsite/blended)
- Include Offer with price info if course cost is mentioned
- Include coursePrerequisites if listed
- If instructor info is available, include instructor as Person
- BreadcrumbList: Home → Courses → Course Name`,

    event: `PAGE TYPE INSTRUCTIONS (Event):
- MUST include Event as mainEntity with: name, startDate (ISO 8601), location (Place with address)
- Include endDate, eventStatus (EventScheduled/EventCancelled/EventMovedOnline), eventAttendanceMode
- Include offers (Offer with price, availability, url) if tickets/registration is mentioned
- Include organizer → Organization
- Include performer/speaker info as Person nodes if listed
- BreadcrumbList: Home → Events → Event Name`,

    review: `PAGE TYPE INSTRUCTIONS (Review):
- MUST include Review as mainEntity with: itemReviewed (Product/Service/Organization), reviewRating (Rating with ratingValue), author → Person
- If aggregate ratings are shown, include AggregateRating with ratingValue, reviewCount, bestRating
- Include datePublished if the review date is visible
- Include reviewBody with the review text
- BreadcrumbList: Home → Reviews → Review Title`,

    pricing: `PAGE TYPE INSTRUCTIONS (Pricing Page):
- Use WebPage as primary type
- Include Offer nodes for each pricing tier/plan with: name, price, priceCurrency, description
- Use priceSpecification for complex pricing (per-month, per-user, etc.)
- If free tier exists, include with price "0"
- Do NOT fabricate pricing — only include what's on the page
- BreadcrumbList: Home → Pricing`,

    recipe: `PAGE TYPE INSTRUCTIONS (Recipe):
- MUST include Recipe as mainEntity with: name, image, recipeIngredient (array of strings), recipeInstructions (array of HowToStep)
- Include cookTime, prepTime, totalTime as ISO 8601 durations if mentioned
- Include recipeYield (servings) if mentioned
- Include nutrition (NutritionInformation) if nutritional facts are listed
- Include author → Person if the recipe author is identified
- Include recipeCategory and recipeCuisine if identifiable
- BreadcrumbList: Home → Recipes → Recipe Name`,

    generic: `PAGE TYPE INSTRUCTIONS (General Page):
- Use WebPage + BreadcrumbList as the baseline
- Include any structured data that's clearly supported by the page content
- Do NOT fabricate entities — only include schema types if the content warrants them
- BreadcrumbList: Home → Page Title`,
  };
  return instructions[pageType] || '';
}

// Full post-processing pipeline: fix → verify content → template → inject refs → validate → auto-fix loop
async function postProcessSchema(
  schema: Record<string, unknown>,
  siteUrl: string,
  pageContent: string,
  html: string | null,
  ctx: SchemaContext,
  isHomepage: boolean,
  siteId?: string,
): Promise<{ schema: Record<string, unknown>; reason: string; errors: string[] }> {
  // Step 1: Auto-fix invalid properties and malformed values
  autoFixSchema(schema);

  // Step 2: Ensure @graph structure
  if (!schema['@graph'] && schema['@type']) {
    const wrapped = { '@context': 'https://schema.org', '@graph': [schema] };
    delete (wrapped['@graph'][0] as Record<string, unknown>)['@context'];
    schema = wrapped;
  }

  // Step 3: Content verification — strip hallucinated factual claims
  const contentWarnings = verifySchemaContent(schema, pageContent, html, ctx);
  if (contentWarnings.length > 0) {
    log.info({ warnings: contentWarnings }, 'Content verification stripped hallucinated values');
  }

  // Step 3a: Remove nodes flagged for removal by content verification (e.g. hallucinated FAQPage)
  const graphBeforeFilter = schema['@graph'] as Record<string, unknown>[] | undefined;
  if (Array.isArray(graphBeforeFilter)) {
    const before = graphBeforeFilter.length;
    schema['@graph'] = graphBeforeFilter.filter(n => !n['_remove']);
    const after = (schema['@graph'] as Record<string, unknown>[]).length;
    if (after < before) {
      log.info(`Removed ${before - after} hallucinated node(s) flagged by content verification`);
    }
  }

  // Step 3b: Site template — unified Organization/WebSite across pages
  const graph = schema['@graph'] as Record<string, unknown>[] | undefined;
  if (Array.isArray(graph) && siteId && ctx.workspaceId) {
    if (isHomepage) {
      // Homepage: extract full Org + WebSite and save as template for future subpages
      const orgNode = graph.find(n => n['@type'] === 'Organization');
      const wsNode = graph.find(n => n['@type'] === 'WebSite');
      if (orgNode) {
        const websiteNode = wsNode || {
          '@type': 'WebSite',
          '@id': `${siteUrl}/#website`,
          'url': siteUrl,
          'name': (orgNode['name'] as string) || ctx.companyName || '',
          'publisher': { '@id': `${siteUrl}/#organization` },
        };
        saveSiteTemplate(siteId, ctx.workspaceId, orgNode, websiteNode);
        log.info(`Saved site template from homepage for site ${siteId}`);
      }
    } else {
      // Subpage: load saved template and use minimal stubs
      const template = getOrSeedSiteTemplate(siteId, ctx.workspaceId);
      if (template) {
        // Replace AI-generated Organization with stub from template (includes logo for consistency)
        const orgIdx = graph.findIndex(n => n['@type'] === 'Organization');
        const orgStub: Record<string, unknown> = {
          '@type': 'Organization',
          '@id': `${siteUrl}/#organization`,
          'name': (template.organizationNode['name'] as string) || ctx.companyName || '',
          'url': (template.organizationNode['url'] as string) || siteUrl,
        };
        // Carry logo from template so subpages have consistent branding
        if (template.organizationNode['logo']) {
          orgStub['logo'] = template.organizationNode['logo'];
        }
        if (orgIdx >= 0) {
          graph[orgIdx] = orgStub;
        }
        // Replace AI-generated WebSite with minimal stub (avoids dangling isPartOf references)
        const wsIdx = graph.findIndex(n => n['@type'] === 'WebSite');
        const wsStub = {
          '@type': 'WebSite',
          '@id': `${siteUrl}/#website`,
          'url': (template.websiteNode['url'] as string) || siteUrl,
          'name': (template.websiteNode['name'] as string) || ctx.companyName || '',
          'publisher': { '@id': `${siteUrl}/#organization` },
        };
        if (wsIdx >= 0) {
          graph[wsIdx] = wsStub;
        }
        log.info(`Applied site template (minimal stubs) for subpage on site ${siteId}`);
      }
    }
  }

  // Step 4: Inject cross-references + ensure WebSite/Organization nodes exist
  injectCrossReferences(schema, siteUrl, ctx.companyName, ctx);

  // Step 4b: Plan validation — strip entities that shouldn't exist per the site plan
  if (ctx._planContext && Array.isArray(schema['@graph'])) {
    const planGraph = schema['@graph'] as Record<string, unknown>[];
    const planCtx = ctx._planContext;
    // If plan says "REFERENCE ONLY" for a type, remove any full node the AI created
    // and ensure a {"@id": "..."} reference exists in WebPage.about or mentions
    const isReferenceOnly = (type: string) =>
      planCtx.includes(`${type}:`) && planCtx.includes('REFERENCE ONLY');
    const isLeadGen = planCtx.includes('Page Role: LEAD-GEN');
    const isAudiencePage = planCtx.includes('Page Role: AUDIENCE');

    for (let i = planGraph.length - 1; i >= 0; i--) {
      const node = planGraph[i];
      const nodeType = String(node['@type'] || '');
      // Lead-gen pages: strip Service/SoftwareApplication nodes
      if (isLeadGen && (nodeType === 'Service' || nodeType === 'SoftwareApplication')) {
        log.info(`Plan validation: removed ${nodeType} from lead-gen page`);
        planGraph.splice(i, 1);
        continue;
      }
      // Audience pages: strip Service/SoftwareApplication — should only reference, not create
      if (isAudiencePage && (nodeType === 'Service' || nodeType === 'SoftwareApplication')) {
        if (isReferenceOnly(nodeType)) {
          log.info(`Plan validation: removed ${nodeType} from audience page (should be reference only)`);
          planGraph.splice(i, 1);
          continue;
        }
      }
    }
  }

  // Step 4c: E-E-A-T author enrichment — pre-populate author on Article/BlogPosting from brief
  if (ctx._briefId && ctx.workspaceId && Array.isArray(schema['@graph'])) {
    try {
      const brief = getBrief(ctx.workspaceId, ctx._briefId);
      if (brief) {
        const eeat = extractEeatFromBrief(brief);
        if (eeat) {
          const eeatGraph = schema['@graph'] as Record<string, unknown>[];
          for (const node of eeatGraph) {
            const nodeType = String(node['@type'] || '');
            if ((nodeType === 'Article' || nodeType === 'BlogPosting' || nodeType === 'NewsArticle') && !node['author']) {
              const authorNode: Record<string, unknown> = { '@type': 'Person' };
              if (eeat.authorName) authorNode['name'] = eeat.authorName;
              if (eeat.authorTitle) authorNode['jobTitle'] = eeat.authorTitle;
              if (eeat.expertiseTopics?.length) authorNode['knowsAbout'] = eeat.expertiseTopics;
              if (authorNode['name']) {
                node['author'] = authorNode;
                log.info({ nodeType, authorName: eeat.authorName }, 'E-E-A-T: pre-populated author on article node from brief');
              }
            }
          }
        }
      }
    } catch (err) {
      log.warn({ err, briefId: ctx._briefId }, 'E-E-A-T post-processing failed — skipping');
    }
  }

  // Step 5: Clean again after modifications (remove any empty values created by stripping)
  const cleaned = cleanSchema(schema);

  // Step 6: Validate
  const errors = validateUnifiedSchema(cleaned);
  const cleanedGraph = cleaned['@graph'] as Record<string, unknown>[];
  const types = cleanedGraph?.map(n => n['@type']).filter(Boolean) || [];

  // Step 7: Auto-fix loop — if validation errors exist, ask AI to fix them (one attempt)
  const fixableErrors = errors.filter(e =>
    !e.includes('appears malformed') // already auto-fixed by autoFixSchema
  );

  if (fixableErrors.length > 0 && process.env.OPENAI_API_KEY) {
    log.info({ errorCount: fixableErrors.length }, 'Schema has validation errors — attempting AI auto-fix');
    try {
      const fixPrompt = `You are a Schema.org JSON-LD expert. The following schema has validation errors. Fix ONLY the listed errors — do not change anything else. Return the corrected JSON-LD object only, no explanation.

CURRENT SCHEMA:
${JSON.stringify(cleaned, null, 2)}

VALIDATION ERRORS TO FIX:
${fixableErrors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

RULES:
- Fix only the specific errors listed above
- Do not remove any nodes or properties that are correct
- Do not add new nodes unless required to fix an error
- All cross-references must use {"@id": "..."} format
- Return ONLY the corrected JSON-LD object`;

      const fixResult = await callOpenAI({
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: fixPrompt }],
        maxTokens: 3000,
        temperature: 0.1,
        feature: 'schema-auto-fix',
        workspaceId: ctx.workspaceId,
        maxRetries: 2,
      });

      if (fixResult.text) {
        let fixJson = fixResult.text;
        const fixMd = fixJson.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fixMd) fixJson = fixMd[1].trim();

        const fixedRaw = JSON.parse(fixJson) as Record<string, unknown>;
        const fixedSchema = cleanSchema(fixedRaw);

        // Re-run auto-fix and cross-references on the fixed version
        autoFixSchema(fixedSchema);
        injectCrossReferences(fixedSchema, siteUrl, ctx.companyName, ctx);

        // Re-validate
        const fixedErrors = validateUnifiedSchema(fixedSchema);
        if (fixedErrors.length < errors.length) {
          log.info({ before: errors.length, after: fixedErrors.length }, 'AI auto-fix reduced validation errors');
          const fixedGraph = fixedSchema['@graph'] as Record<string, unknown>[];
          const fixedTypes = fixedGraph?.map(n => n['@type']).filter(Boolean) || [];
          return {
            schema: fixedSchema,
            reason: `Unified @graph schema with ${fixedTypes.join(', ')} (auto-fixed ${errors.length - fixedErrors.length} error${errors.length - fixedErrors.length > 1 ? 's' : ''})`,
            errors: fixedErrors,
          };
        }
        log.info('AI auto-fix did not improve errors — keeping original');
      }
    } catch (fixErr) {
      log.warn({ err: fixErr }, 'AI auto-fix failed — keeping original schema');
    }
  }

  // Add content verification warnings to the errors list for visibility
  const allErrors = [...errors, ...contentWarnings.map(w => `[content-check] ${w}`)];

  return {
    schema: cleaned,
    reason: `Unified @graph schema with ${types.join(', ')}`,
    errors: allErrors,
  };
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
  const info = html ? extractStructuredInfo(html) : { emails: [], phones: [], images: [], questions: [], author: '', publishDate: '', steps: [], videoUrls: [] };

  const companyName = ctx.companyName || '(unknown — infer from page content)';
  const siteUrl = ctx.liveDomain ? (ctx.liveDomain.startsWith('http') ? ctx.liveDomain : `https://${ctx.liveDomain}`) : baseUrl;

  // Build keyword context
  let keywordBlock = '';
  if (ctx.pageKeywords) {
    keywordBlock = `\nTARGET KEYWORDS FOR THIS PAGE:\n- Primary: ${ctx.pageKeywords.primary}\n- Secondary: ${ctx.pageKeywords.secondary.join(', ') || 'none'}`;
    if (ctx.searchIntent) keywordBlock += `\n- Search Intent: ${ctx.searchIntent}`;
  }
  if (ctx._pageAnalysis?.topicCluster) {
    keywordBlock += `\n- Topic Cluster: ${ctx._pageAnalysis.topicCluster}`;
  }
  if (ctx._pageAnalysis?.contentGaps?.length) {
    keywordBlock += `\nCONTENT GAPS (consider schema types that address these): ${ctx._pageAnalysis.contentGaps.slice(0, 5).join('; ')}`;
  }
  if (ctx._pageAnalysis?.optimizationScore) {
    keywordBlock += `\n- Page Optimization Score: ${ctx._pageAnalysis.optimizationScore}/100`;
  }
  if (ctx.siteKeywords?.length) {
    keywordBlock += `\nSITE-LEVEL KEYWORDS: ${ctx.siteKeywords.slice(0, 10).join(', ')}`;
  }

  // Build page-type schema guidance
  let schemaTypeGuidance = '';
  if (ctx.pageType && ctx.pageType !== 'auto') {
    const mapped = PAGE_TYPE_SCHEMA_MAP[ctx.pageType];
    if (mapped && mapped.primary.length > 0) {
      schemaTypeGuidance = `\nSCHEMA TYPE GUIDANCE (based on page type "${ctx.pageType}"):\n- Primary: ${mapped.primary.join(', ')}\n- Secondary (if applicable): ${mapped.secondary.join(', ')}\nFocus on populating these types with accurate properties from the page content.\nDo not add other types unless the page content strongly warrants it.`;
    }
  }

  // Build E-E-A-T author/expertise context from linked brief
  let eeatBlock = '';
  if (ctx._briefId && ctx.workspaceId) {
    try {
      const brief = getBrief(ctx.workspaceId, ctx._briefId);
      if (brief) {
        const eeat = extractEeatFromBrief(brief);
        if (eeat) {
          const parts: string[] = [];
          if (eeat.authorName) parts.push(`Author Name: ${eeat.authorName}`);
          if (eeat.authorTitle) parts.push(`Author Credentials: ${eeat.authorTitle}`);
          if (eeat.expertiseTopics?.length) parts.push(`Expertise Topics: ${eeat.expertiseTopics.join(', ')}`);
          eeatBlock = `\nAUTHOR / E-E-A-T CREDENTIALS (from content brief):\nThe content brief recommends the following author credentials:\n${parts.join('\n')}\nIf this page uses Article or BlogPosting, populate the "author" field with a Person node using this data.`;
          log.info({ briefId: ctx._briefId, eeat }, 'Injected E-E-A-T data from brief into schema prompt');
        }
      }
    } catch (err) {
      log.warn({ err, briefId: ctx._briefId }, 'Failed to load brief for E-E-A-T extraction — skipping');
    }
  }

  const prompt = `You are a Google Structured Data expert. Generate ONE production-ready JSON-LD schema for this page using the @graph pattern. The schema must pass Google's Rich Results Test with zero errors.

SITE INFO:
- Company: ${companyName}
- Site URL: ${siteUrl}
- Logo: ${ctx.logoUrl || '(not available)'}
${ctx.businessContext ? `- Business Context: ${ctx.businessContext}` : ''}
${keywordBlock}${schemaTypeGuidance}
${ctx.knowledgeBase ? `\nBUSINESS KNOWLEDGE BASE (use ONLY confirmed facts from this for schema fields like credentials, locations, sameAs URLs, specialties — never fabricate):\n${ctx.knowledgeBase.slice(0, 2000)}` : ''}${eeatBlock}

PAGE INFO:
- URL: ${pageUrl}
- Title: ${seoTitle || pageTitle}
- Meta Description: ${seoDesc || '(none)'}
- Is Homepage: ${isHomepage}
- Page Type: ${ctx.pageType && ctx.pageType !== 'auto' ? ctx.pageType : '(auto-detect from content)'}
- Existing Schemas: ${existingSchemas.length > 0 ? existingSchemas.join(', ') : 'None'}
${info.author ? `- Author: ${info.author}` : ''}
${info.publishDate ? `- Publish Date: ${info.publishDate}` : ''}
${info.emails.length ? `- Emails: ${info.emails.join(', ')}` : ''}
${info.phones.length ? `- Phones: ${info.phones.join(', ')}` : ''}
${info.images.length ? `- Key Images: ${info.images.slice(0, 3).join(', ')}` : ''}
${info.questions.length ? `- FAQ Questions Found: ${info.questions.join(' | ')}` : ''}
${info.steps.length ? `- How-To Steps Detected (${info.steps.length}): ${info.steps.slice(0, 5).map((s, i) => `Step ${i + 1}: ${s.slice(0, 80)}`).join(' | ')}` : ''}
${info.videoUrls.length ? `- Video Embed URLs Detected: ${info.videoUrls.join(', ')}` : ''}
${(ctx._gscPageData || ctx._ga4PageData) ? `
SEARCH PERFORMANCE (this page — use to prioritize richness and breadth of schema):
${ctx._gscPageData ? `- GSC: ${ctx._gscPageData.impressions.toLocaleString()} impressions/90d | ${ctx._gscPageData.clicks.toLocaleString()} clicks | Avg Position: ${ctx._gscPageData.position.toFixed(1)} | CTR: ${(ctx._gscPageData.ctr * 100).toFixed(2)}%` : ''}
${ctx._ga4PageData ? `- GA4: ${ctx._ga4PageData.pageviews.toLocaleString()} pageviews/90d | ${ctx._ga4PageData.users.toLocaleString()} users | Avg Engagement: ${Math.round(ctx._ga4PageData.avgEngagementTime)}s` : ''}
High-impression pages with poor position (>10) are prime candidates for rich result schema types like FAQPage, HowTo, and Article.` : ''}
${getPageTypeInstructions(ctx.pageType, siteUrl)}
${ctx._planContext || ''}
${ctx._personasBlock ? `\n${ctx._personasBlock}` : ''}
${ctx._businessProfile ? `\nTRUSTED BUSINESS PROFILE (verified by admin — use these values directly, they do NOT need to appear in page content):
${ctx._businessProfile.phone ? `- Phone: ${ctx._businessProfile.phone}` : ''}
${ctx._businessProfile.email ? `- Email: ${ctx._businessProfile.email}` : ''}
${ctx._businessProfile.address ? `- Address: ${[ctx._businessProfile.address.street, ctx._businessProfile.address.city, ctx._businessProfile.address.state, ctx._businessProfile.address.zip, ctx._businessProfile.address.country].filter(Boolean).join(', ')}` : ''}
${ctx._businessProfile.socialProfiles?.length ? `- Social/External Profiles (use for Organization.sameAs): ${ctx._businessProfile.socialProfiles.join(', ')}` : ''}
${ctx._businessProfile.openingHours ? `- Opening Hours: ${ctx._businessProfile.openingHours}` : ''}
${ctx._businessProfile.foundedDate ? `- Founded: ${ctx._businessProfile.foundedDate}` : ''}
${ctx._businessProfile.numberOfEmployees ? `- Employees: ${ctx._businessProfile.numberOfEmployees}` : ''}` : ''}
PAGE CONTENT (excerpt):
${pageContent.slice(0, 3000)}

REQUIREMENTS:
1. Return ONE JSON-LD object with "@context": "https://schema.org" and an "@graph" array
2. The @graph MUST include a WebPage node on every page
3. On the HOMEPAGE: include a FULL Organization node (name, url, description, logo, knowsAbout, sameAs) and a WebSite node. These will be saved as the site-wide template.
4. On SUBPAGES: include only a MINIMAL Organization stub with @id, name, url — no description, logo, knowsAbout, or sameAs. Do NOT include a WebSite node. Focus your tokens on the page-specific entities (Service, Article, FAQPage, etc.).
5. NEVER include a SearchAction unless the site has a real, confirmed search endpoint. Do NOT use "?s={search_term_string}" — that is a WordPress convention.
6. Add page-specific types based on content (Article, FAQPage, Service, Product, BreadcrumbList, HowTo, Event, LocalBusiness, Dataset, etc.)
7. Use "@id" cross-references between nodes (e.g. Organization "@id": "${siteUrl}/#organization")
8. Fill ALL values from actual page content — ZERO placeholders, ZERO fabricated data
9. CRITICAL: NEVER invent or fabricate addresses, phone numbers, email addresses, opening hours, geo coordinates, or any contact information. Only include these fields if the EXACT data appears in the page content above. If a LocalBusiness is appropriate but the page lacks an address, include the LocalBusiness with only the fields you can confirm from the content (name, url, description). Omit address/telephone/openingHours/geo entirely if not found.
10. For images, use full absolute URLs (prefix with ${siteUrl} if relative). Only use image URLs found in the page content.
11. FAQPage: ONLY use FAQPage schema if the page has a DEDICATED FAQ section with clearly labeled questions and answers (e.g. an accordion, a "Frequently Asked Questions" heading, or a visible Q&A list). Section headings like "What's under the hood?" or "How it works" followed by feature descriptions are NOT FAQs — they are rhetorical headings. When in doubt, do NOT include FAQPage. Never fabricate Q&A pairs.
12. Article/BlogPosting: use real author name, real dates, real headline from the content. ALWAYS include "author" with "@type": "Person" and real credentials if found. If a medical/health reviewer is mentioned, add "reviewedBy" with "@type": "Person" and their credentials.
13. BreadcrumbList: use the FLAT format — each ListItem has "name" and "item" (URL string) directly, NOT nested inside an "item" object. Use SHORT navigational labels for "name" (e.g. "Platform", "Clara", "Pricing", "Blog"), NOT the full page title. Example: {"@type":"ListItem","position":1,"name":"Home","item":"${siteUrl}/"}
14. LocalBusiness for multi-location/region pages: include "parentOrganization": {"@id": "${siteUrl}/#organization"} to link the location to the parent brand
15. Every @type must have all Google-required fields filled with REAL data from the page
16. If you cannot determine a required value from the content, OMIT that @type entirely rather than using a placeholder or fabricating data
16b. LEAD-GEN / CONVERSION PAGES (slugs like /demo, /contact, /request-demo, /get-started, /pricing, /signup, /book): Do NOT create a Service or SoftwareApplication node as mainEntity. These pages are about taking an action, not describing a product. Use only WebPage + Organization stub + BreadcrumbList.
16c. EVERY Service and SoftwareApplication MUST include a "url" field pointing to the canonical product page (e.g. "${siteUrl}/platform"), NOT to the current page if the current page is a comparison, demo, or landing page.
16d. If multiple pages describe the SAME product, use a CONSISTENT @id for the Service/SoftwareApplication across all of them (e.g. "${siteUrl}/platform/#service" or "${siteUrl}/#software"). Do NOT create page-specific @ids like "${siteUrl}/faros-vs-dx/#service" for the same product.
17. HEALTHCARE / MEDICAL SITES: If the business context or page content indicates a healthcare provider (dental, medical, clinic, hospital, therapy, etc.):
    - Use "MedicalBusiness" or more specific subtypes ("Dentist", "Physician", "Optician", etc.) instead of generic "LocalBusiness"
    - For treatment/procedure pages, use "MedicalProcedure" with procedureType, howPerformed, preparation, followup if found in content
    - For provider/doctor profile pages, use "Physician" with medicalSpecialty, credentials, and hospitalAffiliation from content
    - For procedural how-to content, use "HowTo" with step-by-step instructions extracted from the page
18. DATASET PAGES: If the page presents data tables, rankings, indexes, or structured data collections, include "Dataset" schema with name, description, distribution (if downloadable), dateModified, and creator referencing the Organization
19. ENTITY LINKING (sameAs): On the Organization node, include a "sameAs" array with links to the business's verified external profiles (Google Business, LinkedIn, Facebook, Yelp, industry association pages) — but ONLY if these URLs actually appear in the page content or site footer. Never fabricate profile URLs
20. SAAS / PLATFORM HOMEPAGES: If the homepage presents a software product or platform:
    - Use "SoftwareApplication" as the primary product node (not Service). Include applicationCategory, operatingSystem ("Web"), and offers if pricing is visible
    - CRITICAL: Product FEATURES (e.g. "dashboards", "team pages", "AI summaries", "widgets") are NOT separate Services. They are features of ONE product. Describe them in the SoftwareApplication description or use "featureList" — do NOT create a Service node for each feature.
    - Only create separate Service nodes if the page presents genuinely DISTINCT products/solutions with their OWN separate URLs (e.g. "Product A" linking to /product-a, "Product B" linking to /product-b)
    - If the page features CUSTOMER TESTIMONIALS or quotes, include them as "review" on the Organization using {"@type": "Review", "author": {"@type": "Person", "name": "..."}, "reviewBody": "..."}. Only use quotes that actually appear on the page.
    - Use "knowsAbout" on the Organization to capture domain expertise areas (keep to 3-5 concise terms, not 10+)

STRUCTURAL RULES — mandatory:
17. ALL major entities (Organization, WebSite, WebPage, SoftwareApplication, Service, FAQPage, Article, LocalBusiness, BreadcrumbList) MUST be top-level nodes in the @graph array with their own "@id". NEVER nest them inside another node's properties — use {"@id": "..."} references instead.
18. EVERY WebPage MUST include "isPartOf": {"@id": "${siteUrl}/#website"}
19. EVERY WebSite MUST include "publisher": {"@id": "${siteUrl}/#organization"}
20. EVERY Service/SoftwareApplication MUST include "provider": {"@id": "${siteUrl}/#organization"}
21. EVERY Article/BlogPosting MUST include "publisher": {"@id": "${siteUrl}/#organization"}
22. WebPage.mainEntity should be an @id REFERENCE to another @graph node, not an inline object. Example: "mainEntity": {"@id": "${siteUrl}/#software"}

QUALITY RULES — strict:
23. NEVER include empty arrays or empty strings. If a property has no value (e.g. "sameAs": []), OMIT it entirely.
24. NEVER include empty objects. If a nested object would have no meaningful properties, omit the parent property.
25. Use CONSISTENT @id naming across all pages. Follow this exact convention:
    - Organization: "${siteUrl}/#organization"
    - WebSite (homepage only): "${siteUrl}/#website"
    - WebPage: "{pageUrl}/#webpage"
    - BreadcrumbList: "{pageUrl}/#breadcrumb"
    - LocalBusiness: "{pageUrl}/#localbusiness"
    - Service (mainEntity): "{pageUrl}/#service"
    - FAQPage: "{pageUrl}/#faq"
    - Article/BlogPosting: "{pageUrl}/#article"
26. For openingHours, prefer the OpeningHoursSpecification format:
    "openingHoursSpecification": [{"@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday",...], "opens": "08:00", "closes": "17:00"}]

PROPERTY RULES — enforced by automated validation:
27. NEVER use these INVALID Schema.org properties — they are commonly hallucinated but do not exist:
    - Organization: "industry", "founded", "headquarters", "employeeCount", "products", "services"
    - Service: "features", "benefits", "pricing"
    - WebPage: "keywords", "category"
    - Person: "title", "company"
    Instead of "industry", use "knowsAbout": ["topic1", "topic2"] on Organization
28. "telephone" values MUST be properly formatted — use "+1-555-123-4567" or "(555) 123-4567" format. Never output malformed numbers like "5551234567" without separators
29. "serviceType" should be 1-3 CONCISE types (e.g. "Context Engineering", "AI Development Tools"). Do NOT keyword-stuff with long phrases — move detailed descriptions to the "description" field instead
30. "knowsAbout" should contain 3-5 concise domain expertise terms, not 10+ verbose phrases
31. Keep "description" fields concise — aim for 1-3 sentences (50-200 words). Move detailed feature lists to other properties (featureList, serviceType) rather than cramming them into description.
32. WebPage "description" should closely mirror the page's meta description when available — do not rewrite or heavily embellish it.
33. HOWTO PAGES: If "How-To Steps Detected" are listed above in PAGE INFO, use those EXACT steps for HowToStep nodes — do NOT paraphrase or reorder. Each HowToStep "name" must be a direct match to step text from the page. Duration in "totalTime" must appear explicitly in the page content. "supply" and "tool" arrays only if explicitly listed on the page.
34. VIDEO PAGES: If "Video Embed URLs Detected" are listed above in PAGE INFO, use the EXACT URL for "embedUrl". "uploadDate" and "thumbnailUrl" MUST come from page content — omit VideoObject entirely if these cannot be found. "duration" must be formatted as ISO 8601 (e.g. "PT5M30S") and must appear in the page content. If both a VideoObject and article content are present, include both as top-level @graph nodes.

Return ONLY the JSON-LD object. No markdown, no explanation, no wrapping.`;

  try {
    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
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

    // Post-processing pipeline: fix → verify → template → inject refs → validate → auto-fix loop
    const finalSchema = await postProcessSchema(schema, siteUrl, pageContent, html, ctx, isHomepage, ctx._siteId);
    return finalSchema;
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
  gscMap?: Map<string, { clicks: number; impressions: number; position: number; ctr: number }>,
  ga4Map?: Map<string, { pageviews: number; users: number; avgEngagementTime: number }>,
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

  // Inject plan context if a site plan exists
  const sitePlan = getSchemaPlan(siteId);
  if (sitePlan && !ctx._planContext) {
    const pagePath = isHomepage ? '/' : (slug ? `/${slug}` : '/');
    ctx._planContext = buildPlanContextForPage(sitePlan, pagePath) || undefined;
  }

  // Inject per-page analytics if maps were provided
  if (gscMap || ga4Map) {
    const lookupPath = (isHomepage ? '/' : (slug ? `/${slug}` : '/')).replace(/\/$/, '') || '/';
    if (gscMap) ctx._gscPageData = gscMap.get(lookupPath);
    if (ga4Map) ctx._ga4PageData = ga4Map.get(lookupPath);
  }

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

  // Compute Rich Results eligibility from the generated schema
  const richResultsEligibility = suggestedSchemas[0]?.template
    ? checkRichResultsEligibility(suggestedSchemas[0].template)
    : undefined;

  return {
    pageId,
    pageTitle: meta.title,
    slug,
    url,
    existingSchemas,
    existingSchemaJson: existingSchemaJson.length > 0 ? existingSchemaJson : undefined,
    suggestedSchemas,
    validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    richResultsEligibility: richResultsEligibility?.length ? richResultsEligibility : undefined,
    savedPageType: ctx.pageType && ctx.pageType !== 'auto' ? ctx.pageType : undefined,
  };
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

  // Look up active schema plan for site-aware generation
  const sitePlan = getSchemaPlan(siteId);

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
  const getPageAnalysis = (pathOrSlug: string): SchemaContext['_pageAnalysis'] => {
    if (!pageKeywordMap) return undefined;
    const normalized = pathOrSlug.startsWith('/') ? pathOrSlug : `/${pathOrSlug}`;
    const match = pageKeywordMap.find(p => p.pagePath === normalized || p.pagePath === `${normalized}/`);
    if (!match || (!match.topicCluster && !match.contentGaps?.length && !match.optimizationScore)) return undefined;
    return { topicCluster: match.topicCluster, contentGaps: match.contentGaps, optimizationScore: match.optimizationScore };
  };

  for (let i = 0; i < pages.length; i += batch) {
    if (isCancelled?.()) { log.info('Cancelled by user'); return results; }
    if (i > 0 && hasAI) await new Promise(r => setTimeout(r, 1500));
    const chunk = pages.slice(i, i + batch);
    log.info(`Processing static pages ${i + 1}-${Math.min(i + batch, pages.length)} of ${pages.length}`);
    const chunkResults = await Promise.all(
      chunk.map(async (page) => {
        // Use publishedPath for full URL (handles nested pages like /about/team)
        const pagePath = resolvePagePath(page);
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
        const normalizedPath = (isHomepage ? '/' : lookupPath).replace(/\/$/, '') || '/';
        const planContext = sitePlan ? buildPlanContextForPage(sitePlan, isHomepage ? '/' : lookupPath) : '';
        const pageCtx: SchemaContext = {
          ...ctx,
          pageKeywords: getPageKeywords(lookupPath),
          searchIntent: getPageIntent(lookupPath),
          _planContext: planContext || undefined,
          _pageAnalysis: getPageAnalysis(lookupPath),
          _gscPageData: gscMap?.get(normalizedPath),
          _ga4PageData: ga4Map?.get(normalizedPath),
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

          const cmsNormalizedPath = (item.path.startsWith('/') ? item.path : `/${item.path}`).replace(/\/$/, '') || '/';
          const pageCtx: SchemaContext = {
            ...ctx,
            pageKeywords: getPageKeywords(slug),
            searchIntent: getPageIntent(slug),
            _pageAnalysis: getPageAnalysis(slug),
            _gscPageData: gscMap?.get(cmsNormalizedPath),
            _ga4PageData: ga4Map?.get(cmsNormalizedPath),
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
