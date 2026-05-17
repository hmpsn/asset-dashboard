import type { IntelligenceOptions, PageProfileSlice } from '../../shared/types/intelligence.js';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type { TrackedAction } from '../../shared/types/outcome-tracking.js';
import type { PageKeywordMap, Workspace } from '../../shared/types/workspace.js';
import type { RecommendationSet } from '../../shared/types/recommendations.js';
import type { SiteNode } from '../site-architecture.js';
import type { PageSeoResult, SeoIssue } from '../audit-page.js';
import type { SchemaValidation } from '../schema-validator.js';
import type { SeoChangeEvent } from '../seo-change-tracker.js';
import type { RankEntry } from '../rank-tracking.js';
import type { ContentBrief, GeneratedPost } from '../../shared/types/content.js';
import type { DecayAnalysis } from '../content-decay.js';
import { createLogger } from '../logger.js';
import { matchPageIdentity, matchPagePath, toAuditFindingPageId } from '../helpers.js';

const log = createLogger('workspace-intelligence/page-profile');

export async function assemblePageProfile(
  workspaceId: string,
  pagePath: string,
  _opts?: IntelligenceOptions,
): Promise<PageProfileSlice> {
  // Page keywords (primary source)
  let pageKw: PageKeywordMap | undefined;
  try {
    const { getPageKeyword } = await import('../page-keywords.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    pageKw = getPageKeyword(workspaceId, pagePath);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assemblePageProfile: page-keywords optional, degrading gracefully');
  }

  // Rank history
  let current: number | null = pageKw?.currentPosition ?? null;
  let previous: number | null = pageKw?.previousPosition ?? null;
  let trend: 'up' | 'down' | 'stable' = 'stable';
  try {
    const { getLatestRanks } = await import('../rank-tracking.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const latest = getLatestRanks(workspaceId);
    const primaryKw = pageKw?.primaryKeyword?.toLowerCase();
    const pageRank: RankEntry | undefined = primaryKw
      ? latest.find(k => k.query.toLowerCase() === primaryKw)
      : undefined;
    if (pageRank) {
      current = pageRank.position ?? current;
      const change = pageRank.change ?? 0;
      trend = change < 0 ? 'up' : change > 0 ? 'down' : 'stable';
    } else if (current != null && previous != null) {
      // Rank tracking has no match for this keyword — fall back to page-keywords data
      trend = current < previous ? 'up' : current > previous ? 'down' : 'stable';
    }
  } catch (err) {
    // Rank tracking module failed — fall back to page-keywords data
    if (current != null && previous != null) {
      trend = current < previous ? 'up' : current > previous ? 'down' : 'stable';
    }
    log.debug({ err, workspaceId }, 'assemblePageProfile: rank tracking optional, degrading gracefully');
  }
  // best = lowest position number seen (lower is better in SEO)
  const best = (current != null && previous != null) ? Math.min(current, previous)
    : current ?? previous;

  // Recommendations for this page
  let recommendations: string[] = [];
  try {
    const { loadRecommendations } = await import('../recommendations.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const recSetPP: RecommendationSet | null = loadRecommendations(workspaceId);
    if (recSetPP?.recommendations) {
      recommendations = recSetPP.recommendations
        .filter(r => r.affectedPages?.some(p => matchPageIdentity(p, pagePath)) && (r.status === 'pending' || !r.status))
        .map(r => r.title ?? r.description ?? '')
        .filter(Boolean);
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assemblePageProfile: recommendations optional, degrading gracefully');
  }

  // Page-specific insights
  let insights: AnalyticsInsight[] = [];
  try {
    const { getInsights } = await import('../analytics-insights-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const all = getInsights(workspaceId);
    insights = all.filter(i => i.pageId ? matchPageIdentity(i.pageId, pagePath) : false).slice(0, 10);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assemblePageProfile: insights optional, degrading gracefully');
  }

  // Page actions
  let actions: TrackedAction[] = [];
  try {
    const { getActionsByPage } = await import('../outcome-tracking.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    actions = getActionsByPage(workspaceId, pagePath);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assemblePageProfile: page actions optional, degrading gracefully');
  }

  // Hoist workspace lookup so both auditIssues and schemaStatus blocks can reuse it.
  let ws: Workspace | null = null;
  try {
    const { getWorkspace } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    ws = getWorkspace(workspaceId) ?? null;
  } catch (err) {
    log.debug({ err, workspaceId }, 'assemblePageProfile: workspace lookup optional, degrading gracefully');
  }

  // Audit issues for this page
  let auditIssues: string[] = [];
  try {
    if (ws?.webflowSiteId) {
      const { getLatestEffectiveSnapshot } = await import('../audit-snapshot-views.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const snap = getLatestEffectiveSnapshot(ws.webflowSiteId, ws.auditSuppressions);
      if (snap?.audit?.pages) {
        const pagData = (snap.audit.pages as PageSeoResult[]).find(p =>
          matchPageIdentity(toAuditFindingPageId(p), pagePath)
          || (p.url ? matchPageIdentity(p.url, pagePath) : false)
        );
        if (pagData?.issues) {
          auditIssues = pagData.issues.map((i: SeoIssue) => i.message).filter(Boolean);
        }
      }
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assemblePageProfile: audit data optional, degrading gracefully');
  }

  // Schema status — schema_validations.pageId is the Webflow UUID (static pages)
  // or cms-{path} synthetic ID (CMS pages), never pagePath. Resolve pagePath →
  // pageId via the schema snapshot (slug→pageId map for static pages), and fall
  // back to toCmsPageId(pagePath) for CMS pages — works immediately post-migration.
  let schemaStatus: PageProfileSlice['schemaStatus'] = 'none';
  try {
    const { getValidations } = await import('../schema-validator.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const { getSchemaSnapshot } = await import('../schema-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const { toCmsPageId } = await import('../webflow-pages.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const validations: SchemaValidation[] = getValidations(workspaceId);
    const snapshot = ws?.webflowSiteId ? getSchemaSnapshot(ws.webflowSiteId) : null;
    // Nested Webflow pages can share leaf slugs, so the URL branch is the authoritative
    // identity match when a page lives below a parent path.
    const resolvedPageId = snapshot?.results.find(r =>
      r.url ? matchPageIdentity(r.url, pagePath) : matchPageIdentity(r.slug, pagePath)
    )?.pageId
      ?? toCmsPageId(pagePath);
    const pageValidation = validations.find(v => v.pageId === resolvedPageId);
    if (pageValidation) {
      const status = pageValidation.status;
      schemaStatus = status === 'valid' ? 'valid' : status === 'warnings' ? 'warnings' : status === 'errors' ? 'errors' : 'none';
    }
  } catch (err) {
    schemaStatus = 'none';
    log.debug({ err, workspaceId }, 'assemblePageProfile: schema status optional, degrading gracefully');
  }

  // Link health — prefer cached InternalLinkResult (from performance-store) which has real
  // inbound/outbound counts per page. Fall back to site-architecture orphan check if no
  // internal-links snapshot exists for this workspace's site.
  let linkHealth = { inbound: 0, outbound: 0, orphan: false };
  try {
    const { getWorkspace: getWsForLinks } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const wsForLinks = getWsForLinks(workspaceId);
    let foundFromLinkData = false;
    if (wsForLinks?.webflowSiteId) {
      try {
        const { getInternalLinks } = await import('../performance-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
        const linkSnapshot = getInternalLinks(wsForLinks.webflowSiteId);
        const linkData = linkSnapshot?.result as import('../internal-links.js').InternalLinkResult | null;
        if (linkData?.pageHealth) {
          const entry = linkData.pageHealth.find(
            ph => matchPagePath(ph.path, pagePath),
          );
          if (entry) {
            linkHealth = {
              inbound: entry.inboundLinks,
              outbound: entry.outboundLinks,
              orphan: entry.isOrphan,
            };
            foundFromLinkData = true;
          }
        }
      } catch (err) {
        log.debug({ err, workspaceId }, 'assemblePageProfile: internal-links snapshot optional, degrading gracefully');
      }
    }
    // Fallback: site-architecture orphan check (no inbound/outbound counts available)
    if (!foundFromLinkData) {
      const { getCachedArchitecture, flattenTree } = await import('../site-architecture.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const arch = await Promise.race([
        getCachedArchitecture(workspaceId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      if (arch) {
        const nodes: SiteNode[] = flattenTree(arch.tree);
        const nodeExists = nodes.some(n => matchPagePath(n.path, pagePath));
        if (nodeExists) {
          linkHealth = {
            inbound: 0,
            outbound: 0,
            orphan: arch.orphanPaths?.some(p => matchPagePath(p, pagePath)) ?? false,
          };
        }
      }
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assemblePageProfile: link health optional, degrading gracefully');
  }

  // SEO edits
  let seoEdits = { currentTitle: '', currentMeta: '', lastEditedAt: null as string | null };
  try {
    const { getSeoChanges } = await import('../seo-change-tracker.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const changes: SeoChangeEvent[] = getSeoChanges(workspaceId, 50);
    const pageChanges = changes.filter(c =>
      (c.pageSlug ? matchPageIdentity(c.pageSlug, pagePath) : false)
      // Legacy events may not consistently distinguish slug/path/pageId; keep this
      // fallback for historical rows even though Webflow UUIDs do not path-match.
      || (c.pageId ? matchPageIdentity(c.pageId, pagePath) : false)
    );
    if (pageChanges.length > 0) {
      seoEdits.lastEditedAt = pageChanges[0].changedAt ?? null;
    }
    seoEdits.currentTitle = pageKw?.pageTitle ?? '';
    seoEdits.currentMeta = '';
  } catch (err) {
    log.debug({ err, workspaceId }, 'assemblePageProfile: SEO changes optional, degrading gracefully');
  }

  // Content status
  let contentStatus: PageProfileSlice['contentStatus'] = null;
  try {
    const { listBriefs } = await import('../content-brief.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const briefs: ContentBrief[] = listBriefs(workspaceId);
    // ContentBrief matches pages via targetKeyword, not URL
    const primaryKw = pageKw?.primaryKeyword?.toLowerCase();
    const hasBrief = primaryKw ? briefs.some(b => b.targetKeyword?.toLowerCase() === primaryKw) : false;
    const matchingBrief = primaryKw ? briefs.find(b => b.targetKeyword?.toLowerCase() === primaryKw) : undefined;

    let hasPost = false;
    let isPublished = false;
    try {
      const { listPosts } = await import('../content-posts-db.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const posts: GeneratedPost[] = listPosts(workspaceId);
      // GeneratedPost links to a brief via briefId; match if the brief targets this page's keyword
      if (matchingBrief) {
        hasPost = posts.some(p => p.briefId === matchingBrief.id);
        isPublished = posts.some(p => p.briefId === matchingBrief.id && p.status === 'approved');
      }
    } catch (err) {
      log.debug({ err, workspaceId }, 'assemblePageProfile: posts optional, degrading gracefully');
    }

    let isDecaying = false;
    try {
      const { loadDecayAnalysis } = await import('../content-decay.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const decayPP: DecayAnalysis | null = loadDecayAnalysis(workspaceId);
      isDecaying = decayPP?.decayingPages?.some(d => matchPageIdentity(d.page, pagePath)) ?? false;
    } catch (err) {
      log.debug({ err, workspaceId }, 'assemblePageProfile: decay analysis optional, degrading gracefully');
    }

    contentStatus = isDecaying ? 'decay_detected' : isPublished ? 'published' : hasPost ? 'has_post' : hasBrief ? 'has_brief' : null;
  } catch (err) {
    contentStatus = null;
    log.debug({ err, workspaceId }, 'assemblePageProfile: content status optional, degrading gracefully');
  }

  // contentGaps — prefer per-page AI keyword analysis from persisted pageMap data,
  // fall back to strategy content gaps filtered by keyword if page analysis hasn't run yet.
  // Strategy-level gaps now live in the content_gaps table (post-#365 normalization),
  // not on `workspace.keywordStrategy.contentGaps`.
  let contentGaps: string[] = pageKw?.contentGaps ?? [];
  if (contentGaps.length === 0) {
    try {
      const { listContentGaps } = await import('../content-gaps.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const allGaps = listContentGaps(workspaceId);
      if (allGaps.length > 0) {
        const primaryKwLower = pageKw?.primaryKeyword?.toLowerCase();
        const matched = primaryKwLower
          ? allGaps.filter(g => g.targetKeyword?.toLowerCase() === primaryKwLower)
          : [];
        const source = matched.length > 0 ? matched : allGaps;
        contentGaps = source.slice(0, 5).map(g => g.topic).filter(Boolean);
      }
    } catch (err) {
      contentGaps = [];
      log.debug({ err, workspaceId }, 'assemblePageProfile: content gaps optional, degrading gracefully');
    }
  }

  // CWV status
  let cwvStatus: PageProfileSlice['cwvStatus'] = null;
  try {
    const { getWorkspace } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const ws = getWorkspace(workspaceId);
    if (ws?.webflowSiteId) {
      const { getPageSpeed } = await import('../performance-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const speedSnap = getPageSpeed(ws.webflowSiteId, 'mobile');
      if (speedSnap?.result) {
        const result = speedSnap.result as { pages?: Array<{ url?: string; slug?: string; score?: number }> }; // as-any-ok: untyped PageSpeed JSON blob
        const pages = result.pages ?? [];
        const pageData = pages.find(p =>
          p.url ? matchPageIdentity(p.url, pagePath) : !!p.slug && matchPageIdentity(p.slug, pagePath)
        );
        if (pageData?.score != null) {
          cwvStatus = pageData.score >= 90 ? 'good' : pageData.score >= 50 ? 'needs_improvement' : 'poor';
        }
      }
    }
  } catch (err) {
    cwvStatus = null;
    log.debug({ err, workspaceId }, 'assemblePageProfile: CWV status optional, degrading gracefully');
  }

  // Merge platform recs with AI keyword analysis recs — both are page-relevant.
  // pageKw.recommendations come from the per-page AI keyword analysis job.
  const kwRecs = pageKw?.recommendations ?? [];
  const allRecommendations = kwRecs.length > 0
    ? [...kwRecs, ...recommendations.filter(r => !kwRecs.includes(r))]
    : recommendations;

  return {
    pagePath,
    primaryKeyword: pageKw?.primaryKeyword ?? null,
    searchIntent: pageKw?.searchIntent ?? null,
    optimizationScore: pageKw?.optimizationScore ?? null,
    recommendations: allRecommendations,
    contentGaps,
    insights,
    actions,
    auditIssues,
    optimizationIssues: pageKw?.optimizationIssues ?? [],
    primaryKeywordPresence: pageKw?.primaryKeywordPresence ?? null,
    competitorKeywords: pageKw?.competitorKeywords ?? [],
    topicCluster: pageKw?.topicCluster ?? null,
    estimatedDifficulty: pageKw?.estimatedDifficulty ?? null,
    schemaStatus,
    linkHealth,
    seoEdits,
    rankHistory: { current, best, trend },
    contentStatus,
    cwvStatus,
  };
}
