import type {
  IntelligenceOptions,
  SeoContextSlice,
  SerpFeatures,
} from '../../shared/types/intelligence.js';
import type { StoredKeywordStrategy } from '../../shared/types/keyword-strategy.js';
import type { RankEntry } from '../rank-tracking.js';
import { getPrimaryMarketLocationCode } from '../local-seo.js';
import { createLogger } from '../logger.js';
import { findPageMapEntry } from '../helpers.js';
import { createStmtCache } from '../db/stmt-cache.js';
import db from '../db/index.js';
import { normalizeSocialProfiles } from '../social-profiles.js';
import {
  buildEffectiveBrandVoiceBlock,
  getRawBrandVoice,
  getRawKnowledge,
} from './seo-context-source.js';
import { readOptionalSlicePart } from './optional-slice-part.js';

const log = createLogger('workspace-intelligence/seo-context');

const stmts = createStmtCache(() => ({
  strategyHistory: db.prepare(
    'SELECT generated_at FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC',
  ),
}));

function buildTopKeywordMovers(
  latest: RankEntry[],
): NonNullable<SeoContextSlice['rankTracking']>['topKeywordMovers'] {
  return [...latest]
    .filter((rank) => typeof rank.change === 'number' && rank.change !== 0)
    .sort((a, b) => {
      const movementDelta = Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0);
      if (movementDelta !== 0) return movementDelta;
      const impressionDelta = b.impressions - a.impressions;
      if (impressionDelta !== 0) return impressionDelta;
      return a.query.localeCompare(b.query);
    })
    .slice(0, 8)
    .map((rank) => ({
      query: rank.query,
      position: rank.position,
      change: rank.change!,
      direction: rank.change! < 0 ? 'improved' : 'declined',
      clicks: rank.clicks,
      impressions: rank.impressions,
      ctr: rank.ctr,
      ...(rank.pagePath ? { pagePath: rank.pagePath } : {}),
      ...(rank.pageTitle ? { pageTitle: rank.pageTitle } : {}),
    }));
}

export async function assembleSeoContext(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<SeoContextSlice> {
  const { getWorkspace } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
  const workspace = getWorkspace(workspaceId);

  // Populate pageMap from the page_keywords table (not from the stored keyword_strategy column,
  // which has pageMap stripped before storage — it only exists at the route layer).
  let livePageMap: Awaited<
    ReturnType<typeof import('../page-keywords.js').listPageKeywords>
  > = [];
  try {
    const { listPageKeywords } = await import('../page-keywords.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    livePageMap = listPageKeywords(workspaceId);
  } catch (pkErr) {
    log.warn(
      { err: pkErr, workspaceId },
      'assembleSeoContext: listPageKeywords failed, falling back to stored pageMap',
    );
  }

  // The table-backed arrays (contentGaps/quickWins/keywordGaps/topicClusters/
  // cannibalization) live in their own tables (post-#365–368 normalization) — the
  // stored keyword_strategy blob has them stripped. Route them through the single
  // assembler (#2) so the AI context sees the real table state. Without this the
  // slice spread the blob (empty arrays for migrated workspaces) and only overrode
  // contentGaps — a latent bug that left the other four arrays empty in AI context.
  let assembled: StoredKeywordStrategy | null = null;
  try {
    const { assembleStoredKeywordStrategy } =
      await import('../keyword-strategy-assembler.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    assembled = assembleStoredKeywordStrategy(workspaceId);
  } catch (asmErr) {
    log.warn(
      { err: asmErr, workspaceId },
      'assembleSeoContext: assembleStoredKeywordStrategy failed, strategy arrays unavailable',
    );
  }

  const base: SeoContextSlice = {
    strategy: workspace?.keywordStrategy
      ? {
          ...workspace.keywordStrategy,
          // pageMap retains the slice's existing blob fallback (the assembler is
          // table-only); the assembler supplies the five normalized arrays.
          pageMap:
            livePageMap.length > 0
              ? livePageMap
              : workspace.keywordStrategy.pageMap,
          contentGaps: assembled?.contentGaps ?? [],
          quickWins: assembled?.quickWins ?? [],
          keywordGaps: assembled?.keywordGaps ?? [],
          topicClusters: assembled?.topicClusters ?? [],
          cannibalization: assembled?.cannibalization ?? [],
        }
      : workspace?.keywordStrategy,
    // Store RAW brand voice value (no headers) for legacy read-only consumers that need
    // the raw workspace.brandVoice text — NOT for prompt injection. Prompt callers MUST
    // use `effectiveBrandVoiceBlock` below (which already applies voice-profile authority).
    // There is intentionally no helper that adds the "BRAND VOICE & STYLE" header to this
    // raw field: any such helper would bypass voice-profile authority and silently drop
    // the entire voice profile feature on calibrated workspaces. For knowledge base,
    // callers still use `formatKnowledgeBaseForPrompt()` because knowledge has no
    // authority-layered variant (it's the same raw text everywhere).
    brandVoice: getRawBrandVoice(workspaceId),
    // Pre-formatted block with voice-profile authority applied. Source of truth:
    // buildEffectiveBrandVoiceBlock(), which honors the rule that voice profile
    // replaces legacy brandVoice only when (a) status === 'calibrated' (Layer 2 system
    // prompt handles DNA/guardrails) or (b) the rendered voiceProfileBlock is authoritative.
    // Intelligence-path callers inject this DIRECTLY — it already carries the emphatic
    // BRAND VOICE header when non-empty.
    effectiveBrandVoiceBlock: buildEffectiveBrandVoiceBlock(workspaceId),
    businessContext: workspace?.keywordStrategy?.businessContext ?? '',
    personas: workspace?.personas ?? [],
    knowledgeBase: getRawKnowledge(workspaceId),
  };

  // Page-specific keywords — populate from strategy.pageMap when pagePath is provided
  if (opts?.pagePath && base.strategy?.pageMap?.length) {
    const pageKw = findPageMapEntry(base.strategy.pageMap, opts.pagePath);
    if (pageKw) base.pageKeywords = pageKw;
  }

  const rankTracking = await readOptionalSlicePart<
    SeoContextSlice['rankTracking']
  >(
    'assembleSeoContext: rank tracking',
    workspaceId,
    undefined,
    async () => {
      const { getTrackedKeywords, getLatestRanks } =
        await import('../rank-tracking.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const tracked = getTrackedKeywords(workspaceId);
      const latest: RankEntry[] = getLatestRanks(workspaceId);
      const improved = latest.filter((k) => (k.change ?? 0) < 0).length; // negative = position number decreased = moved up in SERPs
      const declined = latest.filter((k) => (k.change ?? 0) > 0).length; // positive = position number increased = dropped in SERPs
      const stable = latest.length - improved - declined;
      const positions = latest.map((k) => k.position).filter((p) => p > 0);
      const avgPosition =
        positions.length > 0
          ? positions.reduce((a: number, b: number) => a + b, 0) /
            positions.length
          : null;
      return {
        trackedKeywords: tracked.length,
        avgPosition,
        positionChanges: { improved, declined, stable },
        topKeywordMovers: buildTopKeywordMovers(latest),
      };
    },
    { logger: log },
  );
  if (rankTracking) base.rankTracking = rankTracking;

  const discoveredQuerySummary = await readOptionalSlicePart<
    SeoContextSlice['discoveredQuerySummary']
  >(
    'assembleSeoContext: discoveredQuerySummary',
    workspaceId,
    undefined,
    async () => {
      const { getDiscoveredQuerySummary } =
        await import('../client-discovered-queries.js'); // dynamic-import-ok - optional discovered query table may not exist during migration windows
      return getDiscoveredQuerySummary(workspaceId);
    },
    { logger: log },
  );
  if (discoveredQuerySummary)
    base.discoveredQuerySummary = discoveredQuerySummary;

  const geoVolumeLabel = await readOptionalSlicePart<string | undefined>(
    'assembleSeoContext: geoVolumeLabel',
    workspaceId,
    undefined,
    () => {
      const geo = getPrimaryMarketLocationCode(workspaceId);
      return geo?.label;
    },
    { logger: log },
  );
  if (geoVolumeLabel) base.geoVolumeLabel = geoVolumeLabel;

  // Business profile from structured intelligence editor (Phase 3B)
  const iProfile = workspace?.intelligenceProfile;
  if (
    iProfile &&
    (iProfile.industry ||
      (iProfile.goals && iProfile.goals.length > 0) ||
      iProfile.targetAudience)
  ) {
    base.businessProfile = {
      industry: iProfile.industry ?? '',
      goals: Array.isArray(iProfile.goals) ? iProfile.goals : [],
      targetAudience: iProfile.targetAudience ?? '',
    };
  }

  // Merge admin-set strategic goals into businessProfile.goals (deduped against intelligenceProfile.goals)
  if (workspace?.businessPriorities?.length) {
    if (!base.businessProfile) {
      base.businessProfile = { industry: '', goals: [], targetAudience: '' };
    }
    const existingGoals = new Set(
      (base.businessProfile.goals ?? []).map((g) => g.trim().toLowerCase()),
    );
    const newGoals = workspace.businessPriorities.filter(
      (g) => !existingGoals.has(g.trim().toLowerCase()),
    );
    base.businessProfile.goals = [
      ...(base.businessProfile.goals ?? []),
      ...newGoals,
    ];
  }

  // Merge verified contact info for local SEO context
  const contactProfile = workspace?.businessProfile;
  const hasContactInfo =
    contactProfile &&
    (contactProfile.phone ||
      contactProfile.email ||
      contactProfile.address ||
      contactProfile.socialProfiles?.length ||
      contactProfile.openingHours ||
      contactProfile.foundedDate ||
      contactProfile.numberOfEmployees);
  if (hasContactInfo) {
    if (!base.businessProfile) {
      base.businessProfile = { industry: '', goals: [], targetAudience: '' };
    }
    if (contactProfile!.phone)
      base.businessProfile.phone = contactProfile!.phone;
    if (contactProfile!.email)
      base.businessProfile.email = contactProfile!.email;
    if (contactProfile!.address) {
      const a = contactProfile!.address;
      base.businessProfile.addressParts = {
        street: a.street,
        city: a.city,
        state: a.state,
        zip: a.zip,
        country: a.country,
      };
      base.businessProfile.address = [
        a.street,
        a.city,
        a.state,
        a.zip,
        a.country,
      ]
        .filter(Boolean)
        .join(', ');
    }
    const normalizedSocialProfiles = normalizeSocialProfiles(
      contactProfile!.socialProfiles,
    );
    if (normalizedSocialProfiles?.length) {
      base.businessProfile.socialProfiles = normalizedSocialProfiles;
    }
    if (contactProfile!.openingHours) {
      base.businessProfile.openingHours = contactProfile!.openingHours;
    }
    if (contactProfile!.foundedDate) {
      base.businessProfile.foundedDate = contactProfile!.foundedDate;
    }
    if (contactProfile!.numberOfEmployees) {
      base.businessProfile.numberOfEmployees =
        contactProfile!.numberOfEmployees;
    }
  }

  const strategyHistory = await readOptionalSlicePart<
    SeoContextSlice['strategyHistory']
  >(
    'assembleSeoContext: strategy history table',
    workspaceId,
    undefined,
    () => {
      const rows = stmts().strategyHistory.all(workspaceId) as Array<{
        generated_at: string;
      }>;
      if (rows.length > 0) {
        return {
          revisionsCount: rows.length,
          lastRevisedAt: rows[0].generated_at,
        };
      }
      return undefined;
    },
    { logger: log },
  );
  if (strategyHistory) base.strategyHistory = strategyHistory;

  // Backlink profile — opt-in only (network call, costs provider credits)
  // Gate with opts.enrichWithBacklinks to avoid hitting the hot-path for the
  // ~16 callers that don't need backlink data (briefs, rewrites, audits, etc.)
  if (opts?.enrichWithBacklinks) {
    const backlinkProfile = await readOptionalSlicePart<
      SeoContextSlice['backlinkProfile']
    >(
      'assembleSeoContext: backlink data',
      workspaceId,
      undefined,
      async () => {
        const { getBacklinksProvider } =
          await import('../seo-data-provider.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
        const domain =
          workspace?.liveDomain
            ?.replace(/^https?:\/\//, '')
            .replace(/\/$/, '') ?? '';
        if (domain) {
          const provider = getBacklinksProvider(workspace?.seoDataProvider);
          if (provider?.isConfigured()) {
            const overview = await provider.getBacklinksOverview(
              domain,
              workspaceId,
            );
            if (overview) {
              return {
                totalBacklinks: overview.totalBacklinks,
                referringDomains: overview.referringDomains,
              };
            }
          }
        }
        return undefined;
      },
      { logger: log },
    );
    if (backlinkProfile) base.backlinkProfile = backlinkProfile;
  }

  // SERP features — aggregate from per-page serpFeatures stored in page_keywords.
  // No external API call needed — this data is captured during strategy generation
  // and stored in the serp_features column (migration 051).
  if (livePageMap.length > 0) {
    const allFeatures = livePageMap.flatMap((p) => p.serpFeatures ?? []);
    if (allFeatures.length > 0) {
      const serpFeatures: SerpFeatures = {
        featuredSnippets: allFeatures.filter((f) => f === 'featured_snippet')
          .length,
        peopleAlsoAsk: allFeatures.filter((f) => f === 'people_also_ask')
          .length,
        localPack: allFeatures.some((f) => f === 'local_pack'),
        videoCarousel: allFeatures.filter((f) => f === 'video').length,
      };
      base.serpFeatures = serpFeatures;
    }
  }

  // Competitor snapshots — latest per tracked domain (Task 4.2c)
  // Reads from competitor_snapshots table (migration 070) via the store.
  // competitorDomains comes from workspace.competitorDomains (stored as JSON).
  const competitorSnapshots = await readOptionalSlicePart<
    SeoContextSlice['competitorSnapshots']
  >(
    'assembleSeoContext: competitor snapshots',
    workspaceId,
    undefined,
    async () => {
      const competitorDomains: string[] = workspace?.competitorDomains ?? [];
      if (competitorDomains.length > 0) {
        const { getLatestCompetitorSnapshot } =
          await import('../competitor-snapshot-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
        const snapshots = [];
        for (const domain of competitorDomains.slice(0, 10)) {
          const snap = getLatestCompetitorSnapshot(workspaceId, domain);
          if (snap) {
            snapshots.push({
              competitorDomain: snap.competitorDomain,
              snapshotDate: snap.snapshotDate,
              keywordCount: snap.keywordCount,
              organicTraffic: snap.organicTraffic,
              topKeywords: snap.topKeywords,
            });
          }
        }
        return snapshots;
      }
      return [];
    },
    { logger: log },
  );
  if (competitorSnapshots) base.competitorSnapshots = competitorSnapshots;

  // Quick wins — low-effort, high-impact fixes with grounded roiScore (SI1).
  // Reads the normalized quick_wins table (post-#367) so the advisor can recite
  // grounded prioritization. Strategy.quickWins is stripped from the JSON blob.
  const quickWins = await readOptionalSlicePart<SeoContextSlice['quickWins']>(
    'assembleSeoContext: quick wins',
    workspaceId,
    undefined,
    async () => {
      const { listQuickWins } = await import('../quick-wins.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const result = listQuickWins(workspaceId);
      return result.length > 0 ? result : undefined;
    },
    { logger: log },
  );
  if (quickWins) base.quickWins = quickWins;

  // Cannibalization issues — keyword cannibalization from the normalized table (SI4).
  const cannibalizationIssues = await readOptionalSlicePart<
    SeoContextSlice['cannibalizationIssues']
  >(
    'assembleSeoContext: cannibalization issues',
    workspaceId,
    undefined,
    async () => {
      const { listCannibalizationIssues } =
        await import('../cannibalization-issues.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const result = listCannibalizationIssues(workspaceId);
      return result.length > 0 ? result : undefined;
    },
    { logger: log },
  );
  if (cannibalizationIssues) base.cannibalizationIssues = cannibalizationIssues;

  // Keyword gaps — keywords competitors rank for that we don't (SEO Gen-Quality P5).
  const keywordGaps = await readOptionalSlicePart<
    SeoContextSlice['keywordGaps']
  >(
    'assembleSeoContext: keyword gaps',
    workspaceId,
    undefined,
    async () => {
      const { listKeywordGaps } = await import('../keyword-gaps.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const result = listKeywordGaps(workspaceId);
      return result.length > 0 ? result : undefined;
    },
    { logger: log },
  );
  if (keywordGaps) base.keywordGaps = keywordGaps;

  // Topic clusters — topical authority coverage per cluster (SEO Gen-Quality P5).
  const topicClusters = await readOptionalSlicePart<
    SeoContextSlice['topicClusters']
  >(
    'assembleSeoContext: topic clusters',
    workspaceId,
    undefined,
    async () => {
      const { listTopicClusters } = await import('../topic-clusters.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const result = listTopicClusters(workspaceId);
      return result.length > 0 ? result : undefined;
    },
    { logger: log },
  );
  if (topicClusters) base.topicClusters = topicClusters;

  // Top opportunity — the resolved #1 recommendation's Opportunity Value breakdown (SI2/MW6).
  // Dynamic import avoids a static cycle (recommendations.ts → workspace-intelligence.ts →
  // seo-context-slice.ts). Carries emvPerWeek for the ADMIN advisor only; the client
  // serialization layer strips it (owner decision). Undefined when no active #1 exists
  // or the #1 carries no opportunity (legacy sets) — additive and safe.
  const topOpportunity = await readOptionalSlicePart<
    SeoContextSlice['topOpportunity']
  >(
    'assembleSeoContext: top opportunity',
    workspaceId,
    undefined,
    async () => {
      const { loadRecommendations, isActiveRec } = await import('../recommendations.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const recSet = loadRecommendations(workspaceId);
      const topId = recSet?.summary?.topRecommendationId ?? null;
      if (topId) {
        const topRec = recSet?.recommendations.find(
          (r) =>
            r.id === topId &&
            isActiveRec(r),
        );
        if (topRec?.opportunity) {
          return {
            recommendationId: topRec.id,
            value: topRec.opportunity.value,
            emvPerWeek: topRec.opportunity.emvPerWeek,
            components: topRec.opportunity.components,
          };
        }
      }
      return undefined;
    },
    { logger: log },
  );
  if (topOpportunity) base.topOpportunity = topOpportunity;

  return base;
}
