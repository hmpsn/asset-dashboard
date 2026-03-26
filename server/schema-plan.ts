/**
 * Schema Site Plan — generates a site-wide schema strategy before per-page generation.
 * Analyzes all pages + keyword strategy to assign roles, identify canonical entities,
 * and produce a blueprint that guides per-page schema generation.
 */
import crypto from 'crypto';
import type { SchemaSitePlan, CanonicalEntity, PageRoleAssignment, SchemaPageRole } from '../shared/types/schema-plan.ts';
import type { KeywordStrategy, PageKeywordMap } from '../shared/types/workspace.ts';
import { callOpenAI } from './openai-helpers.js';
import { resolvePagePath } from './helpers.js';
import { createLogger } from './logger.js';
import { saveSchemaPlan } from './schema-store.js';
import { listPages, filterPublishedPages, discoverCmsUrls, buildStaticPathSet } from './webflow.js';
import type { SiteArchitectureResult } from './site-architecture.js';
import { flattenTree } from './site-architecture.js';
import { crawlCompetitorSchemas, compareSchemas } from './competitor-schema.js';

const log = createLogger('schema-plan');

export interface PlanContext {
  siteId: string;
  workspaceId: string;
  siteUrl: string;
  companyName?: string;
  businessContext?: string;
  strategy?: KeywordStrategy;
  tokenOverride?: string;
  architectureResult?: SiteArchitectureResult;
  competitorDomains?: string[];  // Competitor domains for schema gap analysis
  ourSchemaTypes?: string[];     // Current schema types we're already using
}

/**
 * Generate a schema site plan by analyzing all pages and keyword strategy data.
 * Returns a plan with canonical entities and page role assignments.
 */
export async function generateSchemaPlan(ctx: PlanContext): Promise<SchemaSitePlan> {
  const { siteId, workspaceId, siteUrl, companyName, businessContext, strategy, tokenOverride, architectureResult, competitorDomains, ourSchemaTypes } = ctx;

  let pageList: PageListItem[];

  if (architectureResult) {
    // ── Architecture tree available — derive page list from tree (no duplicate API calls) ──
    const nodes = flattenTree(architectureResult.tree, true);
    pageList = nodes
      .filter(n => n.source === 'existing') // Only include published pages for schema assignment
      .filter(n => {
        const lp = n.path.toLowerCase();
        return !/\/(password|404|thank|success)/.test(lp);
      })
      .map(n => {
        const isHomepage = n.path === '/' || n.depth === 0;
        const strategyMatch = strategy?.pageMap?.find(
          (pm: PageKeywordMap) => pm.pagePath === n.path || pm.pagePath === n.path.replace(/\/$/, ''),
        );
        return {
          path: n.path,
          title: n.name || '(untitled)',
          isHomepage,
          primaryKeyword: n.keyword || strategyMatch?.primaryKeyword || '',
          searchIntent: strategyMatch?.searchIntent || '',
          pageType: n.pageType,
          depth: n.depth,
        };
      });
    log.info(`Schema plan using architecture tree: ${pageList.length} existing pages (tree has ${nodes.length} total nodes)`);
  } else {
    // ── Fallback: fetch pages directly from Webflow API + sitemap ──
    const allPages = await listPages(siteId, tokenOverride);
    const pages = filterPublishedPages(allPages).filter(
      (p: { title: string; slug: string }) =>
        !(p.title || '').toLowerCase().includes('password') &&
        !(p.slug || '').toLowerCase().includes('password'),
    );

    pageList = pages.map((p) => {
      const pagePath = resolvePagePath(p);
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

    // Discover CMS/collection pages from the sitemap
    if (siteUrl) {
      try {
        const staticPaths = buildStaticPathSet(pages);
        const { cmsUrls, totalFound } = await discoverCmsUrls(siteUrl, staticPaths, 500);
        log.info(`Discovered ${cmsUrls.length} CMS pages (${totalFound} total in sitemap) for schema plan`);
        for (const cms of cmsUrls) {
          const lp = cms.path.toLowerCase();
          if (/\/(password|404|thank|success)/.test(lp)) continue;

          const strategyMatch = strategy?.pageMap?.find(
            (pm: PageKeywordMap) => pm.pagePath === cms.path || pm.pagePath === cms.path.replace(/\/$/, ''),
          );

          pageList.push({
            path: cms.path,
            title: cms.pageName || '(CMS page)',
            isHomepage: false,
            primaryKeyword: strategyMatch?.primaryKeyword || '',
            searchIntent: strategyMatch?.searchIntent || '',
          });
        }
      } catch (err) {
        log.warn({ err }, 'CMS page discovery failed — plan will only include static pages');
      }
    }
    log.info(`Generating schema plan for ${pageList.length} pages (static + CMS) on ${siteUrl}`);
  }

  // Crawl competitor schema types for gap analysis (best-effort, non-blocking)
  let competitorSchemaGaps: string[] = [];
  if (competitorDomains && competitorDomains.length > 0) {
    try {
      const domainsToCheck = competitorDomains.slice(0, 2); // Limit to 2 competitors
      const crawlResults = await Promise.allSettled(
        domainsToCheck.map(domain => crawlCompetitorSchemas(domain, 20)),
      );
      const ours = ourSchemaTypes || [];
      for (const result of crawlResults) {
        if (result.status === 'fulfilled') {
          const comparison = compareSchemas(ours, result.value);
          for (const t of comparison.typesTheyHaveWeNot) {
            if (!competitorSchemaGaps.includes(t)) competitorSchemaGaps.push(t);
          }
        }
      }
      if (competitorSchemaGaps.length > 0) {
        log.info({ gaps: competitorSchemaGaps }, `Competitor schema gaps identified: ${competitorSchemaGaps.join(', ')}`);
      }
    } catch (err) {
      log.warn({ err }, 'Competitor schema crawl failed — proceeding without gap data');
    }
  }

  // Try AI-generated plan first
  const aiPlan = await aiGeneratePlan(pageList, siteUrl, companyName, businessContext, strategy, workspaceId, competitorSchemaGaps);

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
  pageType?: string;   // From architecture tree (e.g. 'blog', 'service', 'landing')
  depth?: number;      // Tree depth — useful for AI context
}

async function aiGeneratePlan(
  pages: PageListItem[],
  siteUrl: string,
  companyName?: string,
  businessContext?: string,
  strategy?: KeywordStrategy,
  workspaceId?: string,
  competitorSchemaGaps?: string[],
): Promise<{ canonicalEntities: CanonicalEntity[]; pageRoles: PageRoleAssignment[] } | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  // Group CMS collection pages to keep prompt manageable for large sites
  // Show all static pages individually, but summarize CMS collections with >5 pages
  const MAX_INDIVIDUAL_PAGES = 150;
  let pageTable: string;
  let collectionSummary = '';

  if (pages.length <= MAX_INDIVIDUAL_PAGES) {
    // Small enough — list every page
    pageTable = pages.map(p => {
      const parts = [p.path, p.title];
      if (p.pageType) parts.push(`type: ${p.pageType}`);
      if (p.primaryKeyword) parts.push(`keyword: "${p.primaryKeyword}"`);
      if (p.searchIntent) parts.push(`intent: ${p.searchIntent}`);
      return parts.join(' | ');
    }).join('\n');
  } else {
    // Large site — group CMS pages by collection prefix, show samples
    const collections = new Map<string, PageListItem[]>();
    const staticPages: PageListItem[] = [];

    for (const p of pages) {
      // Detect collection prefix: 2+ pages sharing the same first path segment
      const segments = p.path.split('/').filter(Boolean);
      if (segments.length >= 2) {
        const prefix = `/${segments[0]}`;
        if (!collections.has(prefix)) collections.set(prefix, []);
        collections.get(prefix)!.push(p);
      } else {
        staticPages.push(p);
      }
    }

    // List all static/top-level pages individually
    const lines = staticPages.map(p => {
      const parts = [p.path, p.title];
      if (p.pageType) parts.push(`type: ${p.pageType}`);
      if (p.primaryKeyword) parts.push(`keyword: "${p.primaryKeyword}"`);
      if (p.searchIntent) parts.push(`intent: ${p.searchIntent}`);
      return parts.join(' | ');
    });

    // For collections: show prefix + count + 3 samples
    const collectionParts: string[] = [];
    for (const [prefix, items] of collections.entries()) {
      if (items.length <= 5) {
        // Small collection — list individually
        for (const p of items) {
          const parts = [p.path, p.title];
          if (p.primaryKeyword) parts.push(`keyword: "${p.primaryKeyword}"`);
          if (p.searchIntent) parts.push(`intent: ${p.searchIntent}`);
          lines.push(parts.join(' | '));
        }
      } else {
        // Large collection — summarize
        const samples = items.slice(0, 3).map(p => `  ${p.path} | ${p.title}`).join('\n');
        lines.push(`${prefix}/* (${items.length} CMS pages — samples below)`);
        collectionParts.push(`Collection "${prefix}/" — ${items.length} pages:\n${samples}\n  ... and ${items.length - 3} more`);
      }
    }

    pageTable = lines.join('\n');
    if (collectionParts.length > 0) {
      collectionSummary = `\nCMS COLLECTIONS (assign the same role to all pages in each collection):\n${collectionParts.join('\n\n')}`;
    }
  }

  const competitorGapBlock = competitorSchemaGaps && competitorSchemaGaps.length > 0
    ? `\nCOMPETITOR SCHEMA GAPS (schema types competitors use that we don't yet — prioritize assigning these types to relevant pages):\n${competitorSchemaGaps.join(', ')}`
    : '';

  const prompt = `You are a Google Structured Data strategist. Analyze this site's pages and produce a schema site plan.

SITE: ${companyName || '(unknown)'} — ${siteUrl}
${businessContext ? `BUSINESS: ${businessContext}` : ''}
${strategy?.siteKeywords?.length ? `SITE KEYWORDS: ${strategy.siteKeywords.slice(0, 10).join(', ')}` : ''}${competitorGapBlock}

PAGES (${pages.length} total):
${pageTable}${collectionSummary}

TASK: Assign each page a ROLE and identify CANONICAL ENTITIES for the site.

ROLES (choose exactly one per page):
- homepage: The main page — gets full Organization + WebSite + product entity
- pillar: The canonical product page for SaaS — owns the primary SoftwareApplication entity
- service: Service business pages — owns a Service entity with serviceType, areaServed, pricing
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
- howto: Step-by-step tutorial/guide pages — HowTo schema with numbered steps eligible for rich results
- video: Pages featuring a primary video — VideoObject schema eligible for video carousel in search
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
5. Blog posts → "blog" — this includes CMS collection pages under /blog/*, /posts/*, /articles/*, /news/*
6. /about, /team, /careers → "about"
7. /faq only if it's a dedicated FAQ page, not a product page with a FAQ section
8. Comparison pages (/vs-*, /compare-*, /alternative-*) → "comparison"
9. Partnership pages (/partner-name, /integrations/partner) → "partnership"
10. CMS collection pages (e.g. /customers/*, /case-studies/*) → "case-study" if they are customer stories
11. CMS collection pages under /integrations/* or /partners/* → "partnership"
12. Resource/guide pages → "blog" (Article schema)
13. You MUST assign a role to EVERY page in the list — do not skip any

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
- For CMS collections with many pages, you may use a WILDCARD entry like { "pagePath": "/blog/*", ... } to assign the same role to all pages in that collection. The system will expand it to individual pages.
- Return ONLY valid JSON, no markdown`;

  try {
    const result = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
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
      'homepage', 'pillar', 'service', 'audience', 'lead-gen', 'blog', 'about', 'contact',
      'location', 'product', 'partnership', 'faq', 'case-study', 'comparison', 'howto', 'video', 'generic',
    ]);

    const rawRoles: PageRoleAssignment[] = parsed.pageRoles.map((pr: Record<string, unknown>) => ({
      pagePath: String(pr.pagePath || ''),
      pageTitle: String(pr.pageTitle || ''),
      role: validRoles.has(String(pr.role)) ? String(pr.role) as SchemaPageRole : 'generic',
      primaryType: String(pr.primaryType || 'WebPage'),
      entityRefs: Array.isArray(pr.entityRefs) ? pr.entityRefs.map(String) : [],
      notes: pr.notes ? String(pr.notes) : undefined,
    }));

    // Expand wildcard entries (e.g. "/blog/*") to individual page entries
    const pageRoles: PageRoleAssignment[] = [];
    const assignedPaths = new Set<string>();

    for (const pr of rawRoles) {
      if (pr.pagePath.endsWith('/*')) {
        // Wildcard — expand to all pages matching the prefix
        const prefix = pr.pagePath.slice(0, -1); // "/blog/*" → "/blog/"
        const matching = pages.filter(p => p.path.startsWith(prefix) && p.path !== prefix.replace(/\/$/, ''));
        for (const p of matching) {
          if (!assignedPaths.has(p.path)) {
            assignedPaths.add(p.path);
            pageRoles.push({
              ...pr,
              pagePath: p.path,
              pageTitle: p.title,
            });
          }
        }
        log.info(`Expanded wildcard ${pr.pagePath} → ${matching.length} pages (role: ${pr.role})`);
      } else {
        if (!assignedPaths.has(pr.pagePath)) {
          assignedPaths.add(pr.pagePath);
          pageRoles.push(pr);
        }
      }
    }

    // Catch any pages the AI missed — assign via fallback
    for (const p of pages) {
      if (!assignedPaths.has(p.path)) {
        const fallback = buildFallbackRoles([p])[0];
        pageRoles.push(fallback);
        assignedPaths.add(p.path);
      }
    }

    const canonicalEntities: CanonicalEntity[] = parsed.canonicalEntities.map((ce: Record<string, unknown>) => ({
      type: String(ce.type || 'Service'),
      name: String(ce.name || ''),
      canonicalUrl: String(ce.canonicalUrl || ''),
      id: String(ce.id || ''),
      description: ce.description ? String(ce.description) : undefined,
    }));

    log.info(`AI plan: ${canonicalEntities.length} entities, ${pageRoles.length} roles (${rawRoles.length} from AI, expanded from wildcards + fallback)`);
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
    } else if (/^\/(blog|posts?|articles?|news|resources?|guides?)\//.test(slug) || /^\/(blog|posts?|articles?|news)$/.test(slug)) {
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
    } else if (/^\/(services?)/.test(slug)) {
      role = 'service';
      primaryType = 'Service';
    } else if (/vs-|compare|alternative/.test(slug)) {
      role = 'comparison';
    } else if (/^\/(customers?|case-stud(y|ies)|success-stor(y|ies))\//.test(slug)) {
      role = 'case-study';
      primaryType = 'Article';
    } else if (/^\/(integrations?|partners?)\//.test(slug)) {
      role = 'partnership';
    } else if (/^\/(how-to|howto|tutorial|guide)s?\//.test(slug) || /^\/(how-to|howto|tutorial|guide)s?$/.test(slug)) {
      role = 'howto' as SchemaPageRole;
      primaryType = 'HowTo';
    } else if (/^\/(video|watch)s?\//.test(slug) || /^\/(video|watch)s?$/.test(slug)) {
      role = 'video' as SchemaPageRole;
      primaryType = 'VideoObject';
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
      lines.push('\nINSTRUCTION: As the pillar page, create the FULL product entity (SoftwareApplication) with all details. This is the canonical source for this product.');
      break;
    case 'service':
      lines.push('\nINSTRUCTION: As a service page, create the FULL Service entity with serviceType, areaServed, pricing details. This is the canonical source for this service.');
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
    case 'howto':
      lines.push('\nINSTRUCTION: Use HowTo as mainEntity with step nodes extracted from numbered lists or "Step N:" headings. Include totalTime if mentioned. Add supply/tool arrays only if explicitly listed on the page.');
      break;
    case 'video':
      lines.push('\nINSTRUCTION: Use VideoObject as mainEntity with name, description, uploadDate, and thumbnailUrl from page content. Include embedUrl for YouTube/Vimeo embeds. Omit VideoObject entirely if uploadDate or thumbnailUrl cannot be found in the content.');
      break;
  }

  return lines.join('\n');
}
