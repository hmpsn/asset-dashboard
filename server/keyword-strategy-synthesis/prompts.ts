import type { KeywordCandidate } from '../../shared/types/keyword-universe.js';
import type { KeywordStrategyPageInfo } from '../keyword-strategy-pages.js';
import type { DomainKeyword } from '../seo-data-provider.js';
import { normalizeKeyword } from '../keyword-intelligence/index.js';

export interface PageGscQuery {
  query: string;
  position: number;
  clicks: number;
  impressions: number;
}

export function buildBatchPagesBlock(
  batch: KeywordStrategyPageInfo[],
  gscByPath: Map<string, PageGscQuery[]>,
  providerKeywordsByPath: Map<string, DomainKeyword[]>,
): string {
  return batch.map(p => {
    let entry = `- ${p.path}: "${p.title}"`;
    if (p.seoTitle) entry += ` | SEO: "${p.seoTitle}"`;
    if (p.seoDesc) entry += ` | Desc: "${p.seoDesc.slice(0, 150)}"`;
    if (p.contentSnippet) entry += `\n  Content: ${p.contentSnippet.slice(0, 800)}`;
    const pageGsc = gscByPath.get(p.path);
    if (pageGsc && pageGsc.length > 0) {
      const topGsc = pageGsc.sort((a, b) => b.impressions - a.impressions).slice(0, 5);
      entry += `\n  GSC: ${topGsc.map(g => `"${g.query}" pos:${g.position.toFixed(1)} clicks:${g.clicks} imp:${g.impressions}`).join(', ')}`;
    }
    const pageSem = providerKeywordsByPath.get(p.path);
    if (pageSem && pageSem.length > 0) {
      const topSem = pageSem.sort((a, b) => b.volume - a.volume).slice(0, 3);
      entry += `\n  SEO provider keywords: ${topSem.map(s => `"${s.keyword}" vol:${s.volume} KD:${s.difficulty}% pos:#${s.position}`).join(', ')}`;
    }
    return entry;
  }).join('\n');
}

export function buildClosedSetBlock(candidates: KeywordCandidate[] | undefined, maxCandidates = 200): string {
  if (!candidates || candidates.length === 0) return '';
  const visible = candidates
    .filter(c => !c.declined)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, maxCandidates);
  if (visible.length === 0) return '';
  const lines = visible.map(c => {
    const annotations: string[] = [];
    if (c.requested) annotations.push('CLIENT-REQUESTED');
    if (typeof c.voteWeight === 'number' && c.voteWeight > 0) annotations.push(`votes:${c.voteWeight}`);
    if (c.priority) annotations.push(`priority:${c.priority}`);
    const meta = `${c.volume ?? 0}/mo${c.difficulty ? ` KD:${c.difficulty}%` : ''}`;
    const tag = annotations.length > 0 ? ` [${annotations.join(', ')}]` : '';
    return `- id:"${c.keyword}" "${c.keyword}" (${meta})${tag}`;
  });
  return `\n\nCLOSED CANDIDATE SET — You MUST select keywords ONLY from this list by their id. Each pick must reference the candidate's id and include a one-line justification. Do NOT invent keywords outside this set:\n${lines.join('\n')}`;
}

export function buildCandidateIds(candidates: KeywordCandidate[] | undefined): Set<string> {
  return new Set((candidates ?? []).map(c => normalizeKeyword(c.keyword)).filter(Boolean));
}

export function resolveClosedSetKeyword(
  candidateIds: Set<string>,
  sourceId: string | undefined,
  keyword: string | undefined,
): string | null {
  const normSourceId = normalizeKeyword(sourceId ?? '');
  if (normSourceId && candidateIds.has(normSourceId)) return normSourceId;
  const normKeyword = normalizeKeyword(keyword ?? '');
  if (normKeyword && candidateIds.has(normKeyword)) return normKeyword;
  return null;
}

export function buildClosedSetPageAssignmentPrompt(opts: {
  businessSection: string;
  closedSetBlock: string;
  batchPages: string;
  batchLength: number;
}): string {
  return `You are an SEO keyword ASSIGNMENT engine. Match each page to the BEST candidate from the CLOSED CANDIDATE SET below — SELECT by id, never invent.
${opts.businessSection}${opts.closedSetBlock}
Pages to analyze:
${opts.batchPages}

Return a JSON OBJECT (not a bare array) with this EXACT shape:
{
  "assignments": [
    {
      "pagePath": "/exact-path",
      "pageTitle": "Page Title",
      "primaryKeyword": "the candidate keyword you selected",
      "primaryKeywordSourceId": "the id of the candidate you selected from the CLOSED CANDIDATE SET",
      "secondaryKeywords": ["3-5 related terms, preferably also candidates from the set"],
      "searchIntent": "commercial|informational|transactional|navigational",
      "justification": "one line: why this candidate fits this page"
    }
  ]
}

Rules:
- MANDATORY: primaryKeyword + primaryKeywordSourceId MUST come from the CLOSED CANDIDATE SET above. Do NOT invent keywords.
- Prefer CLIENT-REQUESTED candidates and higher-priority/higher-vote candidates when a reasonable page match exists.
- If a page has GSC or SEO provider data among the candidates, prefer those (proven ranking terms).
- If multiple pages could target the same candidate, assign it to the MOST relevant page. Pages can share candidates.
- LOCATION TARGETING: If a page references a specific city/state/region, keywords MUST target THAT location.
- Cover ALL ${opts.batchLength} pages — do not skip any.
- Return ONLY valid JSON, no markdown, no explanation.`;
}

export function buildLegacyPageAssignmentPrompt(opts: {
  businessSection: string;
  keywordPoolReference: string;
  batchPages: string;
  batchLength: number;
  hasPool: boolean;
}): string {
  return `You are an SEO keyword ASSIGNMENT engine. Your job is to match each page to the BEST keyword from a verified keyword pool — NOT to invent keywords.
${opts.businessSection}${opts.keywordPoolReference}
Pages to analyze:
${opts.batchPages}

Return a JSON array with one entry per page:
[
  {
    "pagePath": "/exact-path",
    "pageTitle": "Page Title",
    "primaryKeyword": "keyword FROM THE POOL above",
    "secondaryKeywords": ["3-5 related terms, preferably also from the pool"],
    "searchIntent": "commercial|informational|transactional|navigational"
  }
]

Rules:
${opts.hasPool ? `- MANDATORY: primaryKeyword MUST be selected from the KEYWORD POOL above. These are real, verified search terms with actual search volume. Do NOT invent keywords.
- If a page has GSC data, the highest-impression GSC query IS your primaryKeyword (it's already in the pool).
- If a page has SEO provider data, prefer those keywords (they're proven ranking terms).
- If multiple pages could target the same keyword, assign it to the MOST relevant page. Other pages can share keywords — that's better than inventing fake ones.
- ONLY if absolutely NO keyword in the pool is even remotely relevant to the page topic, you may suggest a SHORT generic industry term (2-4 words). Mark these with "(invented)" suffix so we can identify them.` : `- primaryKeyword must be a real search term people actually use on Google. Short, generic industry terms (2-4 words).
- If GSC data is available, PREFER the highest-impression GSC query.`}
- Blog posts, changelog entries, and update pages CAN share the same broader keyword — that's better than inventing a niche term nobody searches for.
- LOCATION TARGETING: If a page references a specific city/state/region, keywords MUST target THAT location.
- Cover ALL ${opts.batchLength} pages — do not skip any
- Return ONLY valid JSON array, no markdown, no explanation`;
}

interface SitePromptOptions {
  businessSection: string;
  pageMappingCount: number;
  keywordSummary: string;
  conflictNote: string;
  gscSummary: string;
  ga4Context: string;
  auditContext: string;
  providerContext: string;
  intelligenceBlock: string;
  hasProviderContext: boolean;
  hasKeywordGaps: boolean;
  competitorDomains: string[];
  competitorBrandTokens: string[];
  conflictsCount: number;
}

export interface ClosedSetSitePromptOptions extends SitePromptOptions {
  closedSetBlock: string;
  effectiveBusinessPriorities: string[];
}

export function buildClosedSetSiteSynthesisPrompt(opts: ClosedSetSitePromptOptions): string {
  const businessPrioritiesBlock = opts.effectiveBusinessPriorities.length > 0
    ? `\n\nBUSINESS PRIORITIES (global context — favor candidates that advance these): ${opts.effectiveBusinessPriorities.join('; ')}`
    : '';
  return `You are a senior SEO strategist. Page-level keywords have already been assigned. Now provide the site-level strategy by SELECTING from the CLOSED CANDIDATE SET — never invent keywords.
${opts.businessSection}
Current keyword assignments (${opts.pageMappingCount} pages):
${opts.keywordSummary}
${opts.conflictNote}${opts.gscSummary}${opts.ga4Context}${opts.auditContext}
${opts.providerContext}${opts.intelligenceBlock}${opts.closedSetBlock}${businessPrioritiesBlock}

Return JSON with this EXACT structure (do NOT include a pageMap — it's already done):
{
  "siteKeywords": ["8-15 primary keywords this site should target overall"],
  "opportunities": ["5-8 specific keyword opportunities the site is missing"],
  "contentGaps": [
    {
      "topic": "New content piece to create",
      "targetKeyword": "primary keyword SELECTED from the CLOSED CANDIDATE SET",
      "targetKeywordSourceId": "the id of the candidate you selected",
      "intent": "informational|commercial|transactional|navigational",
      "priority": "high|medium|low",
      "rationale": "Why and expected impact",
      "suggestedPageType": "blog|landing|service|location|product|pillar|resource",
      "competitorProof": "competitor.com ranks #3 (optional — cite if a competitor ranks for this keyword)"
    }
  ],
  "quickWins": [
    {
      "pagePath": "/exact-path-from-list-above",
      "action": "Specific actionable fix",
      "estimatedImpact": "high|medium|low",
      "rationale": "Why this improves rankings"
    }
  ]${opts.conflictsCount > 0 ? `,
  "keywordFixes": [
    { "pagePath": "/path", "newPrimaryKeyword": "better unique keyword" }
  ]` : ''}
}

Rules:
- siteKeywords: 8-15 broad themes covering the full site, drawn from the CLOSED CANDIDATE SET.
- contentGaps: 6-10 NEW pages/posts to create that DO NOT overlap with existing pages listed above. CRITICAL: every targetKeyword + targetKeywordSourceId MUST be SELECTED from the CLOSED CANDIDATE SET — do NOT invent keywords. ${opts.hasKeywordGaps ? 'PRIORITIZE keywords from COMPETITOR KEYWORD GAPS — these are keywords competitors rank for that this site doesn\'t. For each gap backed by competitor data, include competitorProof citing which competitor ranks and at what position. At least 50% of content gaps should come from competitor gap data.' : ''} CLIENT-REQUESTED candidates (tagged in the set) get HIGH PRIORITY: if a client-requested candidate has no existing page covering it, it MUST appear as a content gap. Before suggesting a content gap, verify no current page already targets that keyword or covers that topic. If an existing page is thin or weak on a topic, suggest it as a quickWin improvement instead of creating a competing new page. Vary intent (informational, commercial, transactional). Mix high and medium priority.
- suggestedPageType: Choose the best page type for each content gap. Use "blog" for informational articles, "landing" for conversion pages, "service" for service descriptions, "location" for local SEO, "product" for product pages, "pillar" for topic hubs, "resource" for guides/downloads.
- quickWins: 3-5 existing pages where small changes boost rankings. Use GSC data if available (high impressions + poor position = opportunity).
- If DEVICE BREAKDOWN shows mobile ranking gaps, include a mobile-optimization quick win.
- If PERIOD COMPARISON shows declining metrics, flag defensive content gaps to recover traffic.
- If GA4 shows high-bounce organic pages, include content-improvement quick wins for those pages.
- If GA4 shows organic landing pages NOT in the keyword map, suggest adding them to the strategy.
- If CONVERSION EVENTS data is available, prioritize keywords for pages that drive conversions. Protect "money pages" — never deprioritize their keywords.
- If TOP CONVERTING PAGES data is available, mention specific conversion events in quickWin rationales.
- If SEO AUDIT data shows high-traffic pages with errors, include them as quickWins with specific fix actions.
- If COUNTRY data shows a dominant market, consider location-specific content gaps.
${opts.hasProviderContext ? '- Use SEO provider data to inform priorities. KD < 40% = quick wins.' : ''}
${opts.competitorDomains.length > 0 ? `- NEVER suggest a keyword that contains a competitor's brand name. Do NOT include keywords containing any of these brand tokens: ${opts.competitorBrandTokens.join(', ')}.` : '- NEVER suggest branded competitor keywords — keywords containing a competitor\'s company or product name.'}
- Return ONLY valid JSON, no markdown`;
}

export interface LegacySitePromptOptions extends SitePromptOptions {
  clientKeywordsAdded: number;
}

export function buildLegacySiteSynthesisPrompt(opts: LegacySitePromptOptions): string {
  return `You are a senior SEO strategist. Page-level keywords have already been assigned. Now provide the site-level strategy.
${opts.businessSection}
Current keyword assignments (${opts.pageMappingCount} pages):
${opts.keywordSummary}
${opts.conflictNote}${opts.gscSummary}${opts.ga4Context}${opts.auditContext}
${opts.providerContext}${opts.intelligenceBlock}

Return JSON with this EXACT structure (do NOT include a pageMap — it's already done):
{
  "siteKeywords": ["8-15 primary keywords this site should target overall"],
  "opportunities": ["5-8 specific keyword opportunities the site is missing"],
  "contentGaps": [
    {
      "topic": "New content piece to create",
      "targetKeyword": "primary keyword (MUST be from keyword-provider/GSC data when available)",
      "intent": "informational|commercial|transactional|navigational",
      "priority": "high|medium|low",
      "rationale": "Why and expected impact",
      "suggestedPageType": "blog|landing|service|location|product|pillar|resource",
      "competitorProof": "competitor.com ranks #3 (optional — cite if a competitor ranks for this keyword)"
    }
  ],
  "quickWins": [
    {
      "pagePath": "/exact-path-from-list-above",
      "action": "Specific actionable fix",
      "estimatedImpact": "high|medium|low",
      "rationale": "Why this improves rankings"
    }
  ]${opts.conflictsCount > 0 ? `,
  "keywordFixes": [
    { "pagePath": "/path", "newPrimaryKeyword": "better unique keyword" }
  ]` : ''}
}

Rules:
- siteKeywords: 8-15 broad themes covering the full site
- contentGaps: 6-10 NEW pages/posts to create that DO NOT overlap with existing pages listed above. CRITICAL: Every targetKeyword MUST come from SEO provider/GSC data above when available — do NOT invent keywords. ${opts.hasKeywordGaps ? 'PRIORITIZE keywords from COMPETITOR KEYWORD GAPS — these are keywords competitors rank for that this site doesn\'t. For each gap backed by competitor data, include competitorProof citing which competitor ranks and at what position. At least 50% of content gaps should come from competitor gap data.' : ''}${opts.clientKeywordsAdded > 0 ? ` CLIENT-REQUESTED KEYWORDS get HIGH PRIORITY: if any client-requested keyword from the pool has no existing page covering it, it MUST appear as a content gap. The client specifically wants to rank for these terms.` : ''} Before suggesting a content gap, verify no current page already targets that keyword or covers that topic. If an existing page is thin or weak on a topic, suggest it as a quickWin improvement instead of creating a competing new page. Vary intent (informational, commercial, transactional). Mix high and medium priority
- suggestedPageType: Choose the best page type for each content gap. Use "blog" for informational articles, "landing" for conversion pages, "service" for service descriptions, "location" for local SEO, "product" for product pages, "pillar" for topic hubs, "resource" for guides/downloads.
- quickWins: 3-5 existing pages where small changes boost rankings. Use GSC data if available (high impressions + poor position = opportunity).
- If DEVICE BREAKDOWN shows mobile ranking gaps, include a mobile-optimization quick win.
- If PERIOD COMPARISON shows declining metrics, flag defensive content gaps to recover traffic.
- If GA4 shows high-bounce organic pages, include content-improvement quick wins for those pages.
- If GA4 shows organic landing pages NOT in the keyword map, suggest adding them to the strategy.
- If CONVERSION EVENTS data is available, prioritize keywords for pages that drive conversions. Protect "money pages" — never deprioritize their keywords.
- If TOP CONVERTING PAGES data is available, mention specific conversion events in quickWin rationales (e.g., "this page drives 15 form_submissions — fixing its meta description could increase CTR").
- If SEO AUDIT data shows high-traffic pages with errors, include them as quickWins with specific fix actions.
- If COUNTRY data shows a dominant market, consider location-specific content gaps.
${opts.hasProviderContext ? '- Use SEO provider data to inform priorities. KD < 40% = quick wins.' : ''}
${opts.competitorDomains.length > 0 ? `- NEVER suggest a keyword that contains a competitor's brand name. Competitor domains are used to identify topic areas and intent gaps — NOT to recommend branded searches that funnel users to a competitor. Specifically, do NOT include keywords containing any of these brand tokens: ${opts.competitorBrandTokens.join(', ')}. If a keyword gap came from competitor data but contains a competitor brand name, skip it and find the next best non-branded gap.` : '- NEVER suggest branded competitor keywords — keywords containing a competitor\'s company or product name. Use competitor data to find topic areas, not to recommend searches that drive users to a competitor.'}
- Return ONLY valid JSON, no markdown`;
}
