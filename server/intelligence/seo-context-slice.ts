import type { IntelligenceOptions, SeoContextSlice, SerpFeatures } from '../../shared/types/intelligence.js';
import type { RankEntry } from '../rank-tracking.js';
import { createLogger } from '../logger.js';
import { findPageMapEntry } from '../helpers.js';
import { createStmtCache } from '../db/stmt-cache.js';
import db from '../db/index.js';

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
  const { buildSeoContext, getRawBrandVoice, getRawKnowledge } = await import('../seo-context.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
  const { getWorkspace } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
  // Pass _skipShadow to prevent circular recursion:
  // buildWorkspaceIntelligence → assembleSeoContext → buildSeoContext → shadow mode → buildWorkspaceIntelligence → ∞
  const ctx = buildSeoContext(workspaceId, opts?.pagePath, opts?.learningsDomain ?? 'all', { _skipShadow: true });
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

  const base: SeoContextSlice = {
    strategy: ctx.strategy
      ? { ...ctx.strategy, pageMap: livePageMap.length > 0 ? livePageMap : ctx.strategy.pageMap }
      : ctx.strategy,
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
    // buildSeoContext().brandVoiceBlock, which honors the rule that voice profile
    // replaces legacy brandVoice only when (a) status === 'calibrated' (Layer 2 system
    // prompt handles DNA/guardrails) or (b) the rendered voiceProfileBlock is non-empty.
    // Intelligence-path callers inject this DIRECTLY — it already carries the emphatic
    // BRAND VOICE header when non-empty.
    effectiveBrandVoiceBlock: ctx.brandVoiceBlock,
    businessContext: ctx.businessContext,
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
    contactProfile.socialProfiles?.length || contactProfile.openingHours
  );
  if (hasContactInfo) {
    if (!base.businessProfile) {
      base.businessProfile = { industry: '', goals: [], targetAudience: '' };
    }
    if (contactProfile!.phone) base.businessProfile.phone = contactProfile!.phone;
    if (contactProfile!.email) base.businessProfile.email = contactProfile!.email;
    if (contactProfile!.address) {
      const a = contactProfile!.address;
      base.businessProfile.address = [a.street, a.city, a.state, a.zip, a.country]
        .filter(Boolean)
        .join(', ');
    }
    if (contactProfile!.socialProfiles?.length) {
      base.businessProfile.socialProfiles = contactProfile!.socialProfiles;
    }
    if (contactProfile!.openingHours) {
      base.businessProfile.openingHours = contactProfile!.openingHours;
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
        // preference and falls back to a capable provider if backlinks are disabled on the
        // primary (e.g. DataForSEO without a backlinks subscription).
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

  return base;
}
