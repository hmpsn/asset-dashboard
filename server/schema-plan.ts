/**
 * Schema Site Plan — generates a site-wide schema strategy before per-page generation.
 * Analyzes all pages + keyword strategy to assign roles, identify canonical entities,
 * and produce a blueprint that guides per-page schema generation.
 */
import crypto from 'crypto';
import type { SchemaSitePlan, CanonicalEntity, PageRoleAssignment, SchemaPageRole } from '../shared/types/schema-plan.ts';
import type { KeywordStrategy, PageKeywordMap } from '../shared/types/workspace.ts';
import { callOpenAI } from './openai-helpers.js';
import { createLogger } from './logger.js';
import { saveSchemaPlan } from './schema-store.js';
import { listPages, filterPublishedPages } from './webflow.js';

const log = createLogger('schema-plan');

export interface PlanContext {
  siteId: string;
  workspaceId: string;
  siteUrl: string;
  companyName?: string;
  businessContext?: string;
  strategy?: KeywordStrategy;
  tokenOverride?: string;
}

/**
 * Generate a schema site plan by analyzing all pages and keyword strategy data.
 * Returns a plan with canonical entities and page role assignments.
 */
export async function generateSchemaPlan(ctx: PlanContext): Promise<SchemaSitePlan> {
  const { siteId, workspaceId, siteUrl, companyName, businessContext, strategy, tokenOverride } = ctx;

  // Fetch all published pages
  const allPages = await listPages(siteId, tokenOverride);
  const pages = filterPublishedPages(allPages).filter(
    (p: { title: string; slug: string }) =>
      !(p.title || '').toLowerCase().includes('password') &&
      !(p.slug || '').toLowerCase().includes('password'),
  );

  // Build page list with strategy enrichment
  const pageList = pages.map((p) => {
    const pagePath = (p.publishedPath || '') || (p.slug ? `/${p.slug}` : '/');
    const isHomepage = !p.slug || p.slug === '' || p.slug === 'home' || p.slug === 'index';
    const strategyMatch = strategy?.pageMap?.find(
      (pm: PageKeywordMap) => pm.pagePath === pagePath || pm.pagePath === `/${p.slug}`,
    );

    return {
      path: isHomepage ? '/' : pagePath,
      title: p.title || '(untitled)',
      isHomepage,
      primaryKeyword: strategyMatch?.primaryKeyword || '',
      searchIntent: strategyMatch?.searchIntent || '',
    };
  });

  log.info(`Generating schema plan for ${pageList.length} pages on ${siteUrl}`);

  // Try AI-generated plan first
  const aiPlan = await aiGeneratePlan(pageList, siteUrl, companyName, businessContext, strategy, workspaceId);

  const now = new Date().toISOString();
  const plan: SchemaSitePlan = {
    id: `plan_${crypto.randomBytes(8).toString('hex')}`,
    siteId,
    workspaceId,
    siteUrl,
    canonicalEntities: aiPlan?.canonicalEntities || [],
    pageRoles: aiPlan?.pageRoles || buildFallbackRoles(pageList),
    status: 'draft',
    generatedAt: now,
    updatedAt: now,
  };

  // Persist
  saveSchemaPlan(plan);
  log.info(`Schema plan generated: ${plan.canonicalEntities.length} entities, ${plan.pageRoles.length} page roles`);
  return plan;
}

interface PageListItem {
  path: string;
  title: string;
  isHomepage: boolean;
  primaryKeyword: string;
  searchIntent: string;
}

async function aiGeneratePlan(
  pages: PageListItem[],
  siteUrl: string,
  companyName?: string,
  businessContext?: string,
  strategy?: KeywordStrategy,
  workspaceId?: string,
): Promise<{ canonicalEntities: CanonicalEntity[]; pageRoles: PageRoleAssignment[] } | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const pageTable = pages.map(p => {
    const parts = [p.path, p.title];
    if (p.primaryKeyword) parts.push(`keyword: "${p.primaryKeyword}"`);
    if (p.searchIntent) parts.push(`intent: ${p.searchIntent}`);
    return parts.join(' | ');
  }).join('\n');

  const prompt = `You are a Google Structured Data strategist. Analyze this site's pages and produce a schema site plan.

SITE: ${companyName || '(unknown)'} — ${siteUrl}
${businessContext ? `BUSINESS: ${businessContext}` : ''}
${strategy?.siteKeywords?.length ? `SITE KEYWORDS: ${strategy.siteKeywords.slice(0, 10).join(', ')}` : ''}

PAGES (${pages.length}):
${pageTable}

TASK: Assign each page a ROLE and identify CANONICAL ENTITIES for the site.

ROLES (choose exactly one per page):
- homepage: The main page — gets full Organization + WebSite + product entity
- pillar: The canonical product/service page — owns the primary SoftwareApplication or Service entity
- audience: Persona/use-case pages that describe the same product for a specific audience — reference the pillar's entity, don't create their own
- lead-gen: Conversion pages (/demo, /contact, /pricing, /signup) — WebPage + BreadcrumbList only, no product entity
- blog: Blog/article content — Article schema with author
- about: About/team/careers pages — WebPage only
- contact: Contact page — WebPage with contact details if available
- location: Location-specific pages — LocalBusiness schema
- product: Distinct product pages (different from the main pillar product)
- partnership: Co-marketing/partner pages — reference the pillar's entity
- faq: Dedicated FAQ pages with real Q&A content
- case-study: Case study/customer story — Article schema
- comparison: Comparison pages (vs competitors) — reference the pillar's entity
- generic: Anything that doesn't fit above — WebPage + BreadcrumbList only

CANONICAL ENTITIES: Identify the DISTINCT products/services this site offers. Most SaaS sites have ONE product.
- Each entity needs: type (SoftwareApplication or Service), name, canonicalUrl (the pillar page), id (@id format)
- Do NOT create separate entities for features of the same product
- Only create multiple entities if the site has genuinely DIFFERENT products with their own pages

RULES:
1. There should be exactly ONE homepage
2. There should be 0-3 pillar pages (most sites have 1)
3. Pages that describe the SAME product for different audiences are "audience", not "pillar"
4. /demo, /contact, /request-demo, /get-started, /pricing, /signup, /book → "lead-gen"
5. Blog posts → "blog"
6. /about, /team, /careers → "about"
7. /faq only if it's a dedicated FAQ page, not a product page with a FAQ section
8. Comparison pages (/vs-*, /compare-*, /alternative-*) → "comparison"
9. Partnership pages (/partner-name, /integrations/partner) → "partnership"

Return JSON with this exact structure:
{
  "canonicalEntities": [
    { "type": "SoftwareApplication", "name": "Product Name", "canonicalUrl": "${siteUrl}/platform", "id": "${siteUrl}/platform/#software", "description": "One-sentence description" }
  ],
  "pageRoles": [
    { "pagePath": "/", "pageTitle": "Homepage", "role": "homepage", "primaryType": "Organization", "entityRefs": ["${siteUrl}/platform/#software"], "notes": "Full Org + WebSite + product entity" },
    { "pagePath": "/platform", "pageTitle": "Platform", "role": "pillar", "primaryType": "SoftwareApplication", "entityRefs": [], "notes": "Canonical product page" },
    { "pagePath": "/ai-leaders", "pageTitle": "For AI Leaders", "role": "audience", "primaryType": "WebPage", "entityRefs": ["${siteUrl}/platform/#software"], "notes": "References product, no own Service node" }
  ]
}

IMPORTANT:
- entityRefs should contain @id strings from canonicalEntities that this page should REFERENCE (not create)
- The pillar page that OWNS an entity should have an empty entityRefs for that entity (it creates it)
- The homepage should reference all canonical entities
- primaryType is the main schema @type for the page's content (not Organization/WebSite — those are handled separately)
- Return ONLY valid JSON, no markdown`;

  try {
    const result = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.1,
      feature: 'schema-plan',
      workspaceId,
      maxRetries: 3,
    });

    if (!result.text) return null;

    const cleaned = result.text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed.canonicalEntities) || !Array.isArray(parsed.pageRoles)) {
      log.warn('AI schema plan missing required arrays');
      return null;
    }

    // Validate and normalize roles
    const validRoles = new Set<string>([
      'homepage', 'pillar', 'audience', 'lead-gen', 'blog', 'about', 'contact',
      'location', 'product', 'partnership', 'faq', 'case-study', 'comparison', 'generic',
    ]);

    const pageRoles: PageRoleAssignment[] = parsed.pageRoles.map((pr: Record<string, unknown>) => ({
      pagePath: String(pr.pagePath || ''),
      pageTitle: String(pr.pageTitle || ''),
      role: validRoles.has(String(pr.role)) ? String(pr.role) as SchemaPageRole : 'generic',
      primaryType: String(pr.primaryType || 'WebPage'),
      entityRefs: Array.isArray(pr.entityRefs) ? pr.entityRefs.map(String) : [],
      notes: pr.notes ? String(pr.notes) : undefined,
    }));

    const canonicalEntities: CanonicalEntity[] = parsed.canonicalEntities.map((ce: Record<string, unknown>) => ({
      type: String(ce.type || 'Service'),
      name: String(ce.name || ''),
      canonicalUrl: String(ce.canonicalUrl || ''),
      id: String(ce.id || ''),
      description: ce.description ? String(ce.description) : undefined,
    }));

    log.info(`AI plan: ${canonicalEntities.length} entities, ${pageRoles.length} roles`);
    return { canonicalEntities, pageRoles };
  } catch (err) {
    log.error({ err }, 'AI schema plan generation failed');
    return null;
  }
}

/** Fallback: assign roles based on slug patterns when AI is unavailable */
function buildFallbackRoles(pages: PageListItem[]): PageRoleAssignment[] {
  return pages.map(p => {
    let role: SchemaPageRole = 'generic';
    let primaryType = 'WebPage';
    const slug = p.path.toLowerCase();

    if (p.isHomepage) {
      role = 'homepage';
      primaryType = 'Organization';
    } else if (/^\/(demo|contact|request-demo|get-started|pricing|signup|book)/.test(slug)) {
      role = 'lead-gen';
    } else if (/^\/(blog|posts?|articles?|news)\//.test(slug) || /^\/(blog|posts?|articles?|news)$/.test(slug)) {
      role = 'blog';
      primaryType = 'Article';
    } else if (/^\/(about|team|careers?)/.test(slug)) {
      role = 'about';
    } else if (/^\/(faq|frequently-asked)/.test(slug)) {
      role = 'faq';
      primaryType = 'FAQPage';
    } else if (/^\/(platform|product|solution)s?$/.test(slug)) {
      role = 'pillar';
      primaryType = 'SoftwareApplication';
    } else if (/vs-|compare|alternative/.test(slug)) {
      role = 'comparison';
    }

    return {
      pagePath: p.path,
      pageTitle: p.title,
      role,
      primaryType,
      entityRefs: [],
      notes: undefined,
    };
  });
}

/**
 * Build the plan context block to inject into per-page schema generation prompts.
 * Returns a string that tells the AI what role this page plays and what entities to reference.
 */
export function buildPlanContextForPage(
  plan: SchemaSitePlan,
  pagePath: string,
): string {
  const pageRole = plan.pageRoles.find(
    pr => pr.pagePath === pagePath || pr.pagePath === pagePath.replace(/\/$/, ''),
  );
  if (!pageRole) return '';

  const lines: string[] = [
    '\nSCHEMA SITE PLAN (this page\'s role in the site-wide entity graph):',
    `- Page Role: ${pageRole.role.toUpperCase()}`,
    `- Primary Schema Type: ${pageRole.primaryType}`,
  ];

  if (pageRole.notes) {
    lines.push(`- Guidance: ${pageRole.notes}`);
  }

  if (plan.canonicalEntities.length > 0) {
    lines.push('\nCanonical Entities (site-wide):');
    for (const entity of plan.canonicalEntities) {
      const isOwned = !pageRole.entityRefs.includes(entity.id);
      const isPillar = pageRole.role === 'pillar' || pageRole.role === 'homepage';
      if (isPillar && isOwned) {
        lines.push(`  ★ ${entity.type}: "${entity.name}" — @id: ${entity.id} — THIS PAGE OWNS this entity (create the full node)`);
      } else if (pageRole.entityRefs.includes(entity.id)) {
        lines.push(`  → ${entity.type}: "${entity.name}" — @id: ${entity.id} — REFERENCE ONLY (use {"@id": "${entity.id}"} in WebPage.about or WebPage.mentions, do NOT create a ${entity.type} node)`);
      }
    }
  }

  // Role-specific instructions
  switch (pageRole.role) {
    case 'homepage':
      lines.push('\nINSTRUCTION: As the homepage, include FULL Organization (with logo, description, knowsAbout, sameAs) + WebSite + product entities.');
      break;
    case 'pillar':
      lines.push('\nINSTRUCTION: As the pillar page, create the FULL product entity (SoftwareApplication or Service) with all details. This is the canonical source for this product.');
      break;
    case 'audience':
      lines.push('\nINSTRUCTION: As an audience page, use WebPage with "about": {"@id": "..."} referencing the canonical product. Do NOT create your own Service or SoftwareApplication node.');
      break;
    case 'lead-gen':
      lines.push('\nINSTRUCTION: As a lead-gen page, use ONLY WebPage + BreadcrumbList. No Service, SoftwareApplication, or FAQPage.');
      break;
    case 'comparison':
      lines.push('\nINSTRUCTION: As a comparison page, use WebPage with "about": {"@id": "..."} referencing the canonical product. Do NOT create duplicate Service nodes.');
      break;
    case 'partnership':
      lines.push('\nINSTRUCTION: As a partnership page, use WebPage with "mentions": {"@id": "..."} referencing the canonical product. Focus on the partnership context.');
      break;
    case 'blog':
      lines.push('\nINSTRUCTION: Use Article or BlogPosting with real author, dates, and headline from the content.');
      break;
    case 'faq':
      lines.push('\nINSTRUCTION: Use FAQPage only if the page has a real dedicated FAQ section with clearly labeled Q&A pairs.');
      break;
  }

  return lines.join('\n');
}
