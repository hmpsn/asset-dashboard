import { getBrief } from '../../content-brief.js';
import { listMatrices } from '../../content-matrices.js';
import { listContentRequests } from '../../content-requests.js';
import { listPosts } from '../../content-posts.js';
import { isProgrammingError } from '../../errors.js';
import { getGA4LandingPages } from '../../google-analytics.js';
import { normalizePageUrl } from '../../utils/page-address.js';
import { stripHtmlToText } from '../../utils/text.js';
import { createLogger } from '../../logger.js';
import { getScoredOutcomeReadbacks, type OutcomeReadbacks } from '../../outcome-tracking.js';
import { getAllGscPages } from '../../search-console.js';
import { getWorkspace } from '../../workspaces.js';
import type {
  ContentBrief,
  ContentPerformanceItem,
  ContentPerformanceJoinback,
  ContentPerformanceResponse,
  ContentTermCoverageGrade,
  GeneratedPost,
} from '../../../shared/types/content.js';

const log = createLogger('content-performance');
const MAX_MISSING_TERMS = 8;

type Audience = 'admin' | 'public';
interface CoverageTerm {
  normalized: string;
  display: string;
}

function unavailableCoverage(reason: string): ContentTermCoverageGrade {
  return {
    status: 'unavailable',
    coveragePct: null,
    requiredCount: 0,
    matchedCount: 0,
    missingCount: 0,
    missingTerms: [],
    reason,
  };
}

function normalizeComparableText(value: string): string {
  return stripHtmlToText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTerm(value: string): string | null {
  const normalized = normalizeComparableText(value);
  if (!normalized || normalized.length < 3) return null;
  const wordCount = normalized.split(' ').filter(Boolean).length;
  if (wordCount > 10) return null;
  return normalized;
}

function displayTerm(value: string): string {
  return stripHtmlToText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function addTerm(terms: Map<string, string>, value: string | undefined): void {
  if (!value) return;
  const normalized = normalizeTerm(value);
  if (!normalized) return;
  if (!terms.has(normalized)) terms.set(normalized, displayTerm(value));
}

function addTerms(terms: Map<string, string>, values: readonly string[] | undefined): void {
  for (const value of values ?? []) addTerm(terms, value);
}

function collectCoverageTerms(brief: ContentBrief): CoverageTerm[] {
  const terms = new Map<string, string>();
  addTerm(terms, brief.targetKeyword);
  addTerms(terms, brief.secondaryKeywords);
  for (const outlineItem of brief.outline) {
    addTerms(terms, outlineItem.keywords);
  }
  addTerms(terms, brief.realPeopleAlsoAsk);
  addTerms(terms, brief.topicalEntities);
  addTerms(terms, brief.serpAnalysis?.commonElements);
  addTerms(terms, brief.serpAnalysis?.gaps);
  for (const result of brief.sourceEvidence?.serpResults ?? []) {
    addTerm(terms, result.title);
    addTerm(terms, result.snippet);
  }
  return Array.from(terms.entries()).map(([normalized, display]) => ({ normalized, display }));
}

function buildPostCoverageText(post: GeneratedPost): string {
  return normalizeComparableText([
    post.title,
    post.metaDescription,
    post.seoTitle,
    post.seoMetaDescription,
    post.introduction,
    ...post.sections.flatMap(section => [
      section.heading,
      section.content,
      ...section.keywords,
    ]),
    post.conclusion,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' '));
}

export function gradeContentTermCoverage(
  brief: ContentBrief | undefined,
  post: GeneratedPost | undefined,
): ContentTermCoverageGrade {
  if (!brief) return unavailableCoverage('No linked brief');
  if (!post) return unavailableCoverage('No linked post');

  const requiredTerms = collectCoverageTerms(brief);
  if (requiredTerms.length === 0) return unavailableCoverage('No prescribed terms found on the linked brief');

  const postText = buildPostCoverageText(post);
  if (!postText) return unavailableCoverage('Linked post has no inspectable text');

  const searchablePostText = ` ${postText} `;
  const missingTerms = requiredTerms.filter(term => !searchablePostText.includes(` ${term.normalized} `));
  const matchedCount = requiredTerms.length - missingTerms.length;
  const coveragePct = Math.round((matchedCount / requiredTerms.length) * 100);
  const status = coveragePct >= 80 ? 'strong' : coveragePct >= 50 ? 'partial' : 'weak';

  return {
    status,
    coveragePct,
    requiredCount: requiredTerms.length,
    matchedCount,
    missingCount: missingTerms.length,
    missingTerms: missingTerms.map(term => term.display).slice(0, MAX_MISSING_TERMS),
  };
}

function buildJoinback(brief: ContentBrief | undefined, post: GeneratedPost | undefined): ContentPerformanceJoinback | undefined {
  if (!brief && !post) return undefined;
  return {
    briefId: brief?.id,
    postId: post?.id,
    briefTitle: brief?.suggestedTitle,
    briefTargetKeyword: brief?.targetKeyword,
    postTitle: post?.title,
    hasSourceEvidence: Boolean(brief?.sourceEvidence),
    evidenceSourceCounts: {
      scrapedReferences: brief?.sourceEvidence?.scrapedReferences?.length ?? 0,
      serpResults: brief?.sourceEvidence?.serpResults?.length ?? 0,
      styleExamples: brief?.sourceEvidence?.styleExamples?.length ?? 0,
      peopleAlsoAsk: brief?.realPeopleAlsoAsk?.length ?? 0,
    },
  };
}

function loadOutcomeReadbacks(workspaceId: string): OutcomeReadbacks | undefined {
  try {
    const readbacks = getScoredOutcomeReadbacks(workspaceId);
    if (readbacks.bySource.size === 0 && readbacks.byKeyword.size === 0) return undefined;
    return readbacks;
  } catch (err) {
    // catch-ok: outcome verdicts are read-side decoration; content performance still renders without them.
    log.debug({ err, workspaceId }, 'Outcome read-back unavailable for content performance');
    return undefined;
  }
}

function lookupOutcome(
  readbacks: OutcomeReadbacks | undefined,
  postId: string | undefined,
  targetKeyword: string | undefined,
): ContentPerformanceItem['outcome'] {
  if (!readbacks) return undefined;
  return (postId ? readbacks.bySource.get(`post::${postId}`) : undefined)
    ?? (targetKeyword ? readbacks.byKeyword.get(targetKeyword.trim().toLowerCase()) : undefined);
}

function scrubForPublic(item: ContentPerformanceItem): ContentPerformanceItem {
  const { joinback: _joinback, coverage, ...rest } = item;
  return {
    ...rest,
    coverage: {
      status: coverage.status,
      coveragePct: coverage.coveragePct,
      requiredCount: coverage.requiredCount,
      matchedCount: coverage.matchedCount,
      missingCount: coverage.missingCount,
      missingTerms: [],
      reason: coverage.status === 'unavailable' ? coverage.reason : undefined,
    },
  };
}

export async function getContentPerformance(
  workspaceId: string,
  options: { audience?: Audience } = {},
): Promise<ContentPerformanceResponse> {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const requests = listContentRequests(workspaceId);
  const published = requests.filter(r => r.status === 'delivered' || r.status === 'published');
  const posts = listPosts(workspaceId);
  const postsById = new Map(posts.map(post => [post.id, post]));
  const postsByBriefId = new Map<string, GeneratedPost>();
  for (const post of posts) {
    if (!postsByBriefId.has(post.briefId)) postsByBriefId.set(post.briefId, post);
  }

  const gscPages: Map<string, { clicks: number; impressions: number; ctr: number; position: number }> = new Map();
  if (ws.gscPropertyUrl && ws.webflowSiteId) {
    try {
      const pages = await getAllGscPages(ws.webflowSiteId, ws.gscPropertyUrl, 90);
      for (const p of pages) {
        try {
          const url = new URL(p.page);
          gscPages.set(url.pathname, { clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position });
        } catch (err) {
          gscPages.set(p.page, { clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position });
        }
      }
    } catch (err) { // url-fetch-ok — GSC/provider or page URL failures degrade to no search metrics.
      if (isProgrammingError(err)) log.warn({ err }, 'content performance GSC read failed');
    }
  }

  const ga4Pages: Map<string, { sessions: number; users: number; bounceRate: number; avgEngagementTime: number; conversions: number }> = new Map();
  if (ws.ga4PropertyId) {
    try {
      const pages = await getGA4LandingPages(ws.ga4PropertyId, 90, 100);
      for (const p of pages) {
        ga4Pages.set(p.landingPage, {
          sessions: p.sessions,
          users: p.users,
          bounceRate: p.bounceRate,
          avgEngagementTime: p.avgEngagementTime,
          conversions: p.conversions,
        });
      }
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'content performance GA4 read failed');
    }
  }

  const now = Date.now();
  const seenKeywords = new Set<string>();
  const outcomeReadbacks = loadOutcomeReadbacks(workspaceId);
  const items: ContentPerformanceItem[] = published.map(request => {
    const slug = request.targetPageSlug;
    const path = slug ? normalizePageUrl(slug) : undefined;
    if (request.targetKeyword) seenKeywords.add(request.targetKeyword.toLowerCase());
    const brief = request.briefId ? getBrief(workspaceId, request.briefId) : undefined;
    const post = request.postId ? postsById.get(request.postId) : (request.briefId ? postsByBriefId.get(request.briefId) : undefined);
    const publishDate = request.updatedAt || request.requestedAt;
    const coverage = gradeContentTermCoverage(brief, post);
    const outcome = lookupOutcome(outcomeReadbacks, post?.id, request.targetKeyword);

    return {
      requestId: request.id,
      topic: request.topic,
      targetKeyword: request.targetKeyword,
      targetPageSlug: request.targetPageSlug,
      pageType: request.pageType,
      status: request.status,
      publishedAt: publishDate,
      daysSincePublish: Math.floor((now - new Date(publishDate).getTime()) / (1000 * 60 * 60 * 24)),
      gsc: path ? (gscPages.get(path) || null) : null,
      ga4: path ? (ga4Pages.get(path) || null) : null,
      source: 'request',
      coverage,
      ...(outcome ? { outcome } : {}),
      joinback: buildJoinback(brief, post),
    };
  });

  try {
    const matrices = listMatrices(workspaceId);
    for (const matrix of matrices) {
      for (const cell of (matrix.cells || [])) {
        if (cell.status !== 'published' || !cell.targetKeyword) continue;
        if (seenKeywords.has(cell.targetKeyword.toLowerCase())) continue;
        seenKeywords.add(cell.targetKeyword.toLowerCase());

        const slug = cell.plannedUrl;
        const path = slug ? normalizePageUrl(slug) : undefined;
        const outcome = lookupOutcome(outcomeReadbacks, undefined, cell.targetKeyword);

        items.push({
          requestId: cell.id,
          topic: cell.variableValues ? Object.values(cell.variableValues).join(' × ') : cell.targetKeyword,
          targetKeyword: cell.targetKeyword,
          targetPageSlug: slug,
          pageType: undefined,
          status: 'published',
          publishedAt: matrix.updatedAt,
          daysSincePublish: Math.floor((now - new Date(matrix.updatedAt).getTime()) / (1000 * 60 * 60 * 24)),
          gsc: path ? (gscPages.get(path) || null) : null,
          ga4: path ? (ga4Pages.get(path) || null) : null,
          source: 'matrix',
          coverage: unavailableCoverage('Matrix item has no linked brief or post'),
          ...(outcome ? { outcome } : {}),
        });
      }
    }
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'content performance matrix read failed');
  }

  items.sort((a, b) => (b.gsc?.clicks || 0) - (a.gsc?.clicks || 0) || a.daysSincePublish - b.daysSincePublish);

  return {
    items: options.audience === 'public' ? items.map(scrubForPublic) : items,
  };
}

export function handleContentPerformance(workspaceId: string): Promise<ContentPerformanceResponse> {
  return getContentPerformance(workspaceId, { audience: 'admin' });
}

export function handlePublicContentPerformance(workspaceId: string): Promise<ContentPerformanceResponse> {
  return getContentPerformance(workspaceId, { audience: 'public' });
}
