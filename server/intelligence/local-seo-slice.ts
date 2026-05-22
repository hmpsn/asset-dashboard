import type { LocalSeoSlice } from '../../shared/types/intelligence.js';
import { getClientLocations } from '../client-locations.js';
import { createLogger } from '../logger.js';
import { isFeatureEnabled } from '../feature-flags.js';

const log = createLogger('workspace-intelligence/local-seo');

const PROMPT_BLOCK_TOTAL_CAP = 50;
const PROMPT_BLOCK_PER_MARKET_CAP = 8;
const PROMPT_BLOCK_MARKET_LIST_CAP = 10;

/**
 * Assemble the local SEO intelligence slice for a workspace.
 *
 * Returned shape:
 *   - `candidates` is the full bounded universe (capped upstream at
 *     LOCAL_CANDIDATE_HARD_CAP in server/local-seo.ts — currently 1000).
 *     MCP consumers receive this entire array.
 *   - `effectiveLocalSeoBlock` is a pre-formatted prompt block that samples
 *     `candidates` internally (stratified per active market, capped at
 *     PROMPT_BLOCK_TOTAL_CAP). AI consumers should inject this string
 *     directly per CLAUDE.md authority-layered fields rule.
 *
 * Workspaces with the feature flag off, no markets configured, or upstream
 * failures still receive a typed empty-but-valid slice — never undefined.
 */
export async function assembleLocalSeo(workspaceId: string): Promise<LocalSeoSlice> {
  const enabled = isFeatureEnabled('local-seo-visibility');

  const baseline: LocalSeoSlice = {
    locations: [],
    enabled,
    markets: [],
    visibility: { visible: 0, possibleMatch: 0, notVisible: 0, notChecked: 0, providerDegraded: 0 },
    candidates: [],
    effectiveLocalSeoBlock: enabled
      ? 'Local SEO is enabled but no markets are configured for this workspace.'
      : 'Local SEO is disabled for this workspace.',
    latestSnapshotAt: null,
  };

  if (!enabled) return baseline;

  try {
    const locations: LocalSeoSlice['locations'] = getClientLocations(workspaceId)
      .filter(location => location.status === 'confirmed')
      .map(location => ({
        id: location.id,
        name: location.name,
        isPrimary: location.isPrimary,
        city: location.city,
        stateOrRegion: location.stateOrRegion,
        pageTargetPath: location.pageTargetPath,
      }));
    const localSeoModule = await import('../local-seo.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const {
      listLocalSeoMarkets,
      buildLocalSeoKeywordCandidates,
      buildLocalSeoKeywordVisibilitySummaryByKey,
      listLatestLocalVisibilitySnapshots,
    } = localSeoModule;

    const rawMarkets = listLocalSeoMarkets(workspaceId);
    if (rawMarkets.length === 0) return { ...baseline, locations };

    const markets: LocalSeoSlice['markets'] = rawMarkets.map(m => ({
      id: m.id,
      label: m.label,
      status: m.status,
      location: [m.city, m.stateOrRegion, m.country].filter(Boolean).join(', '),
    }));

    // Slice surfaces keyword/source/sourceLabel/pageTitle/pagePath/marketId/volume/
    // difficulty/score. Reasons are not exposed; suppression is not required.
    // Cheap default is the right contract for AdminChat, content gen, recommendation
    // gen, MCP — and the upcoming local SEO recommendations layer. The Evaluated
    // variant remains opt-in for callers that genuinely need scoreDelta+reasons.
    const rawCandidates = buildLocalSeoKeywordCandidates(workspaceId);
    const candidates: LocalSeoSlice['candidates'] = rawCandidates.map(c => ({
      keyword: c.keyword,
      source: c.source,
      sourceLabel: c.sourceLabel,
      pageTitle: c.pageTitle,
      pagePath: c.pagePath,
      // marketId is not currently populated on LocalSeoKeywordCandidate — see TODO below.
      marketId: undefined,
      volume: c.volume,
      difficulty: c.difficulty,
      score: c.score,
    }));

    const visibility = { visible: 0, possibleMatch: 0, notVisible: 0, notChecked: 0, providerDegraded: 0 };
    const visibilityByKey = buildLocalSeoKeywordVisibilitySummaryByKey(workspaceId);
    for (const summary of visibilityByKey.values()) {
      // Each summary's `markets` array contains per-market visibility entries.
      for (const marketEntry of summary.markets) {
        switch (marketEntry.posture) {
          case 'visible': visibility.visible++; break;
          case 'possible_match': visibility.possibleMatch++; break;
          case 'not_visible':
          case 'local_pack_present':
            visibility.notVisible++; break;
          case 'provider_degraded': visibility.providerDegraded++; break;
        }
      }
    }

    // notChecked count: keywords that have no snapshot for some active market.
    // Cheap approximation: candidate count minus visibility-summary entries.
    visibility.notChecked = Math.max(0, candidates.length - visibilityByKey.size);

    let latestSnapshotAt: string | null = null;
    try {
      const snapshots = listLatestLocalVisibilitySnapshots(workspaceId);
      for (const s of snapshots) {
        if (!latestSnapshotAt || s.capturedAt > latestSnapshotAt) latestSnapshotAt = s.capturedAt;
      }
    } catch (err) {
      log.debug({ err, workspaceId }, 'latest snapshot lookup failed; leaving null');
    }

    const sampledCandidates = stratifiedSample(candidates, markets, PROMPT_BLOCK_PER_MARKET_CAP, PROMPT_BLOCK_TOTAL_CAP);
    const effectiveLocalSeoBlock = renderLocalSeoBlock({
      locations,
      markets,
      visibility,
      sampledCandidates,
      latestSnapshotAt,
    });

    return { locations, enabled, markets, visibility, candidates, effectiveLocalSeoBlock, latestSnapshotAt };
  } catch (err) {
    log.warn({ err, workspaceId }, 'assembleLocalSeo: failed, degrading to empty slice');
    return baseline;
  }
}

/**
 * Top N per active market, capped at total. Falls back to flat top-N if no
 * marketId data is present on candidates (current state — see TODO in assembler).
 */
function stratifiedSample(
  candidates: LocalSeoSlice['candidates'],
  markets: LocalSeoSlice['markets'],
  perMarket: number,
  total: number,
): LocalSeoSlice['candidates'] {
  const activeMarkets = markets.filter(m => m.status === 'active');
  const hasMarketId = candidates.some(c => c.marketId);
  if (!hasMarketId || activeMarkets.length === 0) {
    return [...candidates].sort((a, b) => b.score - a.score).slice(0, total);
  }
  const byMarket = new Map<string, LocalSeoSlice['candidates'][number][]>();
  for (const market of activeMarkets) byMarket.set(market.id, []);
  const unassigned: LocalSeoSlice['candidates'][number][] = [];
  for (const c of candidates) {
    if (c.marketId && byMarket.has(c.marketId)) byMarket.get(c.marketId)!.push(c);
    else unassigned.push(c);
  }
  const picked: LocalSeoSlice['candidates'][number][] = [];
  for (const list of byMarket.values()) {
    list.sort((a, b) => b.score - a.score);
    picked.push(...list.slice(0, perMarket));
  }
  unassigned.sort((a, b) => b.score - a.score);
  for (const c of unassigned) {
    if (picked.length >= total) break;
    picked.push(c);
  }
  return picked.sort((a, b) => b.score - a.score).slice(0, total);
}

function renderLocalSeoBlock(args: {
  locations: LocalSeoSlice['locations'];
  markets: LocalSeoSlice['markets'];
  visibility: LocalSeoSlice['visibility'];
  sampledCandidates: LocalSeoSlice['candidates'];
  latestSnapshotAt: string | null;
}): string {
  const { locations, markets, visibility, sampledCandidates, latestSnapshotAt } = args;
  const lines: string[] = [];
  if (locations.length > 0) {
    lines.push(`Configured client locations (${locations.length} confirmed):`);
    for (const location of locations.slice(0, PROMPT_BLOCK_MARKET_LIST_CAP)) {
      const city = [location.city, location.stateOrRegion].filter(Boolean).join(', ');
      const primary = location.isPrimary ? 'primary' : 'branch';
      const target = location.pageTargetPath ? ` -> ${location.pageTargetPath}` : '';
      lines.push(`  - ${location.name}${city ? ` (${city})` : ''} [${primary}]${target}`);
    }
    lines.push('');
  }
  const activeCount = markets.filter(m => m.status === 'active').length;
  lines.push(`Local SEO posture (${activeCount} active markets):`);
  for (const market of markets.slice(0, PROMPT_BLOCK_MARKET_LIST_CAP)) {
    lines.push(`  - ${market.label} (${market.status})`);
  }
  lines.push('');
  lines.push(
    `Visibility coverage: ${visibility.visible} visible / ${visibility.possibleMatch} possible match / ${visibility.notVisible} not visible / ${visibility.notChecked} not checked / ${visibility.providerDegraded} provider degraded.`,
  );
  if (sampledCandidates.length > 0) {
    lines.push('');
    lines.push('Top local keyword candidates (stratified sample across active markets):');
    for (const c of sampledCandidates) {
      const where = c.pageTitle ?? c.pagePath ?? c.sourceLabel;
      const market = c.marketId ? ` [${c.marketId}]` : '';
      lines.push(`  - "${c.keyword}"${market} — ${where} (score ${c.score})`);
    }
  }
  if (latestSnapshotAt) {
    lines.push('');
    lines.push(`Latest visibility snapshot: ${latestSnapshotAt}.`);
  }
  return lines.join('\n');
}

/**
 * Filter the slice's candidates by relevance to a target keyword or topic.
 * Used by content generation to surface only locally relevant candidates per piece.
 *
 * Relevance heuristic:
 *  - Same marketId as any candidate matching the target (so we keep neighbors in
 *    the target market) — only effective once candidates carry marketId.
 *  - Shared service stem (token overlap >= 1 with target after normalization)
 *  - Falls back to score-sorted top-N when no target is provided.
 *
 * Returns at most `limit` candidates (default 15).
 */
export function selectRelevantLocalCandidates(
  slice: LocalSeoSlice,
  target: string | undefined,
  limit = 15,
): LocalSeoSlice['candidates'] {
  if (!slice.enabled || slice.candidates.length === 0) return [];
  if (!target) {
    return [...slice.candidates].sort((a, b) => b.score - a.score).slice(0, limit);
  }
  const targetTokens = new Set(
    target.toLowerCase().split(/\s+/).filter(t => t.length > 2),
  );
  const targetCandidate = slice.candidates.find(
    c => c.keyword.toLowerCase() === target.toLowerCase(),
  );
  const targetMarketId = targetCandidate?.marketId;
  // Score each candidate; relevant candidates (token overlap OR market match) get a
  // large additive boost so they dominate raw-score ordering. Within each tier, score
  // is the tiebreaker.
  const RELEVANCE_TIER_BOOST = 1_000_000;
  const scored = slice.candidates.map(c => {
    const cTokens = c.keyword.toLowerCase().split(/\s+/);
    let overlap = 0;
    for (const t of cTokens) if (targetTokens.has(t)) overlap++;
    const marketMatch = targetMarketId && c.marketId === targetMarketId;
    const isRelevant = overlap > 0 || marketMatch;
    const relevance =
      (isRelevant ? RELEVANCE_TIER_BOOST : 0)
      + overlap * 100
      + (marketMatch ? 50 : 0)
      + c.score;
    return { candidate: c, relevance };
  });
  scored.sort((a, b) => b.relevance - a.relevance);
  return scored.slice(0, limit).map(s => s.candidate);
}

// TODO(local-seo-marketId-passthrough): LocalSeoKeywordCandidate in server/local-seo.ts
// does not currently carry a `marketId` field — candidates are generated from page-level
// inputs that don't associate to a specific market. When that changes, the stratified
// sampler will start providing per-market coverage in prompts and `selectRelevantLocalCandidates`
// will apply its marketBonus heuristic. Until then, both fall back to flat score-sorted top-N.
