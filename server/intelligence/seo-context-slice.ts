import type { IntelligenceOptions, SeoContextSlice, SerpFeatures } from '../../shared/types/intelligence.js';
import type { StoredKeywordStrategy } from '../../shared/types/keyword-strategy.js';
import type { RankEntry } from '../rank-tracking.js';
import { getPrimaryMarketLocationCode } from '../local-seo.js';
import { createLogger } from '../logger.js';
import { findPageMapEntry } from '../helpers.js';
import { createStmtCache } from '../db/stmt-cache.js';
import db from '../db/index.js';
import { normalizeSocialProfiles } from '../social-profiles.js';
import { buildEffectiveBrandVoiceBlock, getRawBrandVoice, getRawKnowledge } from './seo-context-source.js';

const log = createLogger('workspace-intelligence/seo-context');

const stmts = createStmtCache(() => ({
  strategyHistory: db.prepare(
    'SELECT generated_at FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC',
  ),
}));

export async function assembleSeoContext(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<SeoContextSlice> {
  const { getWorkspace } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
  const workspace = getWorkspace(workspaceId);

  // Populate pageMap from the page_keywords table (not from the stored keyword_strategy column,
  // which has pageMap stripped before storage — it only exists at the route layer).
  let livePageMap: Awaited<ReturnType<typeof import('../page-keywords.js').listPageKeywords>> = [];
  try {
    const { listPageKeywords } = await import('../page-keywords.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    livePageMap = listPageKeywords(workspaceId);
  } catch (pkErr) {
    log.warn({ err: pkErr, workspaceId }, 'assembleSeoContext: listPageKeywords failed, falling back to stored pageMap');
  }

  // The table-backed arrays (contentGaps/quickWins/keywordGaps/topicClusters/
  // cannibalization) live in their own tables (post-#365–368 normalization) — the
  // stored keyword_strategy blob has them stripped. Route them through the single
  // assembler (#2) so the AI context sees the real table state. Without this the
  // slice spread the blob (empty arrays for migrated workspaces) and only overrode
  // contentGaps — a latent bug that left the other four arrays empty in AI context.
  let assembled: StoredKeywordStrategy | null = null;
  try {
    const { assembleStoredKeywordStrategy } = await import('../keyword-strategy-assembler.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    assembled = assembleStoredKeywordStrategy(workspaceId);
  } catch (asmErr) {
    log.warn({ err: asmErr, workspaceId }, 'assembleSeoContext: assembleStoredKeywordStrategy failed, strategy arrays unavailable');
  }

  const base: SeoContextSlice = {
    strategy: workspace?.keywordStrategy
      ? {
          ...workspace.keywordStrategy,
          // pageMap retains the slice's existing blob fallback (the assembler is
          // table-only); the assembler supplies the five normalized arrays.
          pageMap: livePageMap.length > 0 ? livePageMap : workspace.keywordStrategy.pageMap,
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

  // Rank tracking enrichment
  try {
    const { getTrackedKeywords, getLatestRanks } = await import('../rank-tracking.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const tracked = getTrackedKeywords(workspaceId);
    const latest: RankEntry[] = getLatestRanks(workspaceId);
    const improved = latest.filter(k => (k.change ?? 0) < 0).length; // negative = position number decreased = moved up in SERPs
    const declined = latest.filter(k => (k.change ?? 0) > 0).length; // positive = position number increased = dropped in SERPs
    const stable = latest.length - improved - declined;
    const positions = latest.map(k => k.position).filter(p => p > 0);
    const avgPosition = positions.length > 0
      ? positions.reduce((a: number, b: number) => a + b, 0) / positions.length
      : null;

    base.rankTracking = {
      trackedKeywords: tracked.length,
      avgPosition,
      positionChanges: { improved, declined, stable },
    };
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleSeoContext: rank tracking optional, degrading gracefully');
  }

  try {
    const { getDiscoveredQuerySummary } = await import('../client-discovered-queries.js'); // dynamic-import-ok - optional discovered query table may not exist during migration windows
    base.discoveredQuerySummary = getDiscoveredQuerySummary(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleSeoContext: discoveredQuerySummary optional, degrading gracefully');
  }

  try {
    const geo = getPrimaryMarketLocationCode(workspaceId);
    if (geo) base.geoVolumeLabel = geo.label;
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleSeoContext: geoVolumeLabel optional, degrading gracefully');
  }

  // Business profile from structured intelligence editor (Phase 3B)
  const iProfile = workspace?.intelligenceProfile;
  if (iProfile && (iProfile.industry || (iProfile.goals && iProfile.goals.length > 0) || iProfile.targetAudience)) {
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
    const existingGoals = new Set((base.businessProfile.goals ?? []).map(g => g.trim().toLowerCase()));
    const newGoals = workspace.businessPriorities.filter(g => !existingGoals.has(g.trim().toLowerCase()));
    base.businessProfile.goals = [...(base.businessProfile.goals ?? []), ...newGoals];
  }

  // Merge verified contact info for local SEO context
  const contactProfile = workspace?.businessProfile;
  const hasContactInfo = contactProfile && (
    contactProfile.phone || contactProfile.email || contactProfile.address ||
    contactProfile.socialProfiles?.length || contactProfile.openingHours ||
    contactProfile.foundedDate || contactProfile.numberOfEmployees
  );
  if (hasContactInfo) {
    if (!base.businessProfile) {
      base.businessProfile = { industry: '', goals: [], targetAudience: '' };
    }
    if (contactProfile!.phone) base.businessProfile.phone = contactProfile!.phone;
    if (contactProfile!.email) base.businessProfile.email = contactProfile!.email;
    if (contactProfile!.address) {
      const a = contactProfile!.address;
      base.businessProfile.addressParts = {
        street: a.street,
        city: a.city,
        state: a.state,
        zip: a.zip,
        country: a.country,
      };
      base.businessProfile.address = [a.street, a.city, a.state, a.zip, a.country]
        .filter(Boolean)
        .join(', ');
    }
    const normalizedSocialProfiles = normalizeSocialProfiles(contactProfile!.socialProfiles);
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
      base.businessProfile.numberOfEmployees = contactProfile!.numberOfEmployees;
    }
  }

  // Strategy history
  try {
    const rows = stmts().strategyHistory.all(workspaceId) as Array<{ generated_at: string }>;
    if (rows.length > 0) {
      base.strategyHistory = {
        revisionsCount: rows.length,
        lastRevisedAt: rows[0].generated_at,
      };
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleSeoContext: strategy history table optional, degrading gracefully');
  }

  // Backlink profile — opt-in only (network call, costs SEMRush credits)
  // Gate with opts.enrichWithBacklinks to avoid hitting the hot-path for the
  // ~16 callers that don't need backlink data (briefs, rewrites, audits, etc.)
  if (opts?.enrichWithBacklinks) {
    try {
      const { getBacklinksProvider } = await import('../seo-data-provider.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const domain = workspace?.liveDomain?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '';
      if (domain) {
        // Pass workspace.seoDataProvider so provider selection respects the per-workspace
        // preference. If DataForSEO is selected/default but backlinks are disabled, backlink
        // enrichment is omitted instead of silently spending SEMRush credits.
        const provider = getBacklinksProvider(workspace?.seoDataProvider);
        if (provider?.isConfigured()) {
          const overview = await provider.getBacklinksOverview(domain, workspaceId);
          if (overview) {
            base.backlinkProfile = {
              totalBacklinks: overview.totalBacklinks,
              referringDomains: overview.referringDomains,
              // trend not computable from BacklinksOverview — omitted
            };
          }
        }
      }
    } catch (err) {
      log.debug({ err, workspaceId }, 'assembleSeoContext: backlink data optional, degrading gracefully');
    }
  }

  // SERP features — aggregate from per-page serpFeatures stored in page_keywords.
  // No external API call needed — this data is captured during strategy generation
  // and stored in the serp_features column (migration 051).
  if (livePageMap.length > 0) {
    const allFeatures = livePageMap.flatMap(p => p.serpFeatures ?? []);
    if (allFeatures.length > 0) {
      const serpFeatures: SerpFeatures = {
        featuredSnippets: allFeatures.filter(f => f === 'featured_snippet').length,
        peopleAlsoAsk: allFeatures.filter(f => f === 'people_also_ask').length,
        localPack: allFeatures.some(f => f === 'local_pack'),
        videoCarousel: allFeatures.filter(f => f === 'video').length,
      };
      base.serpFeatures = serpFeatures;
    }
  }

  // Competitor snapshots — latest per tracked domain (Task 4.2c)
  // Reads from competitor_snapshots table (migration 070) via the store.
  // competitorDomains comes from workspace.competitorDomains (stored as JSON).
  try {
    const competitorDomains: string[] = workspace?.competitorDomains ?? [];
    if (competitorDomains.length > 0) {
      const { getLatestCompetitorSnapshot } = await import('../competitor-snapshot-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const snapshots = [];
      for (const domain of competitorDomains.slice(0, 10)) { // cap at 10 competitors
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
      base.competitorSnapshots = snapshots;
    } else {
      base.competitorSnapshots = [];
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleSeoContext: competitor snapshots optional, degrading gracefully');
  }

  // Quick wins — low-effort, high-impact fixes with grounded roiScore (SI1).
  // Reads the normalized quick_wins table (post-#367) so the advisor can recite
  // grounded prioritization. Strategy.quickWins is stripped from the JSON blob.
  try {
    const { listQuickWins } = await import('../quick-wins.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const quickWins = listQuickWins(workspaceId);
    if (quickWins.length > 0) base.quickWins = quickWins;
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleSeoContext: quick wins optional, degrading gracefully');
  }

  // Cannibalization issues — keyword cannibalization from the normalized table (SI4).
  try {
    const { listCannibalizationIssues } = await import('../cannibalization-issues.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const cannibalizationIssues = listCannibalizationIssues(workspaceId);
    if (cannibalizationIssues.length > 0) base.cannibalizationIssues = cannibalizationIssues;
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleSeoContext: cannibalization issues optional, degrading gracefully');
  }

  // Keyword gaps — keywords competitors rank for that we don't (SEO Gen-Quality P5).
  try {
    const { listKeywordGaps } = await import('../keyword-gaps.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const keywordGaps = listKeywordGaps(workspaceId);
    if (keywordGaps.length > 0) base.keywordGaps = keywordGaps;
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleSeoContext: keyword gaps optional, degrading gracefully');
  }

  // Topic clusters — topical authority coverage per cluster (SEO Gen-Quality P5).
  try {
    const { listTopicClusters } = await import('../topic-clusters.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const topicClusters = listTopicClusters(workspaceId);
    if (topicClusters.length > 0) base.topicClusters = topicClusters;
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleSeoContext: topic clusters optional, degrading gracefully');
  }

  // Top opportunity — the resolved #1 recommendation's Opportunity Value breakdown (SI2/MW6).
  // Dynamic import avoids a static cycle (recommendations.ts → workspace-intelligence.ts →
  // seo-context-slice.ts). Carries emvPerWeek for the ADMIN advisor only; the client
  // serialization layer strips it (owner decision). Undefined when no active #1 exists
  // or the #1 carries no opportunity (legacy sets) — additive and safe.
  try {
    const { loadRecommendations } = await import('../recommendations.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const recSet = loadRecommendations(workspaceId);
    const topId = recSet?.summary?.topRecommendationId ?? null;
    if (topId) {
      const topRec = recSet?.recommendations.find(
        r => r.id === topId && r.status !== 'completed' && r.status !== 'dismissed',
      );
      if (topRec?.opportunity) {
        base.topOpportunity = {
          recommendationId: topRec.id,
          value: topRec.opportunity.value,
          emvPerWeek: topRec.opportunity.emvPerWeek,
          components: topRec.opportunity.components,
        };
      }
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'assembleSeoContext: top opportunity optional, degrading gracefully');
  }

  return base;
}
