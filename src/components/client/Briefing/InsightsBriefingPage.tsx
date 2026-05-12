// CLIENT-FACING
// Composes the magazine briefing on the client Insights tab — Phase 2.5b.
//
// Reading rhythm (paid tier):
//   [WeeklyOpener — Premium 2.5e, optional] → DateLine → IssueSummaryLine
//     → ActionQueueStrip → PulseStrip → MonthlyDigestContent (snapshot)
//     → DataSpread → RecommendedForYou → SecondaryStoryRow list (incl. hero)
//
// Free tier renders unchanged from Phase 2:
//   ActionQueueStrip → FreeTierUpgradeCTA → MonthlyDigestContent
// (Phase 2.5b explicitly does not extend the free-tier branch.)

import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import type { Tier } from '../../ui';
import { LoadingState, EmptyState, Icon } from '../../ui';
import { useClientBriefing } from '../../../hooks/client/useClientBriefing';
import { useMonthlyDigest } from '../../../hooks/client/useMonthlyDigest';
import {
  useClientApprovals,
  useClientContentRequests,
  useClientAuditSummary,
} from '../../../hooks/client';
import { useClientGA4 } from '../../../hooks/client/useClientGA4';
import { useClientSearch } from '../../../hooks/client/useClientSearch';
import { clientPath } from '../../../routes';
import type { BriefingRecommendation, BriefingStory } from '../../../../shared/types/briefing';
import { ActionQueueStrip, computeStaleness } from './ActionQueueStrip';
import { SecondaryStoryRow } from './SecondaryStoryRow';
import { FreeTierUpgradeCTA } from './FreeTierUpgradeCTA';
import { MonthlyDigestContent } from '../MonthlyDigest';
import { DateLine } from './DateLine';
import { IssueSummaryLine } from './IssueSummaryLine';
import { WeeklyOpener } from './WeeklyOpener';
import { PulseStrip, type PulseStripData } from './PulseStrip';
import { DataSpread, spreadItemFromStory, type SpreadItem } from './DataSpread';
import { RecommendedForYou } from './RecommendedForYou';
import { renderDrillInUrl } from './drillIn';
import { useFeatureFlag } from '../../../hooks/useFeatureFlag';
import { WinsSurface } from './WinsSurface';

interface InsightsBriefingPageProps {
  workspaceId: string;
  effectiveTier: Tier;
  betaMode: boolean;
  actionCounts: {
    approvals: number;
    briefs: number;
    posts: number;
    replies: number;
    contentPlan: number;
  };
}

/** 28-day Pulse window — matches the existing GSC/GA4 default. */
const PULSE_DAYS = 28;

export function InsightsBriefingPage({
  workspaceId,
  effectiveTier,
  betaMode,
  actionCounts,
}: InsightsBriefingPageProps) {
  const navigate = useNavigate();
  const isFree = effectiveTier === 'free';
  const winsEnabled = useFeatureFlag('client-wins-surface');

  // ── Briefing draft (paid only) ──
  const { data: briefing, isLoading } = useClientBriefing(workspaceId, !isFree);

  // ── Monthly digest snapshot (BOTH tiers) ──
  // Phase 2.5b shipped with the digest fetched only on the free branch
  // (un-gated tease). Per user direction, the snapshot replaces the
  // single-story `<HeroStoryCard>` at the top of the paid magazine —
  // matches the legacy InsightsDigest UX clients were used to. Both
  // tiers now fetch; the composer's render path branches on tier.
  const { data: digest, isLoading: digestLoading } = useMonthlyDigest(workspaceId);

  // ── Pulse data sources (paid only) ──
  // Audit summary drives Site Health; GSC drives clicks/impressions/avg-position;
  // GA4 drives Visitors. All hooks share the global staleTime so this composer
  // shares cache with other paid-tier views (Performance, Strategy).
  const { data: audit } = useClientAuditSummary(workspaceId, !isFree);
  const ga4 = useClientGA4(workspaceId, PULSE_DAYS, undefined, !isFree);
  const search = useClientSearch(workspaceId, PULSE_DAYS, undefined, !isFree);

  // ── Stale-item escalation sources (paid only) ──
  // Approvals expose `createdAt`; content requests expose `requestedAt`. The
  // composer collects ms-epoch timestamps for both and lets `computeStaleness`
  // count items >7d old + the oldest age. Content-plan review cells don't
  // expose timestamps via the public endpoint today, so they're omitted from
  // the staleness signal. Free tier skips this — the strip renders unchanged.
  const { data: approvals = [] } = useClientApprovals(workspaceId, !isFree);
  const { data: contentRequests = [] } = useClientContentRequests(workspaceId, !isFree);

  const staleTimestamps: number[] = [];
  // Only items that still need client action contribute to the escalation
  // pill. ApprovalBatch.status is one of pending|partial|approved|rejected|applied;
  // the latter three are terminal states that should never raise an "urgent"
  // signal even if they're old. Mirrors the content-requests filter below.
  for (const a of approvals) {
    if (a.status !== 'pending' && a.status !== 'partial') continue;
    const ts = parseTs(a.createdAt);
    if (ts !== null) staleTimestamps.push(ts);
  }
  for (const r of contentRequests) {
    if (r.status === 'client_review' || r.status === 'post_review') {
      const ts = parseTs(r.requestedAt);
      if (ts !== null) staleTimestamps.push(ts);
    }
  }
  const staleness = computeStaleness(staleTimestamps);

  // ── Pulse data assembly ──
  const pulseData: PulseStripData | null =
    !isFree && (audit || ga4.ga4Overview || search.overview)
      ? {
          siteHealth: {
            score: audit?.siteScore ?? null,
            delta:
              audit?.siteScore != null && audit.previousScore != null
                ? audit.siteScore - audit.previousScore
                : null,
          },
          visitors: {
            current: ga4.ga4Overview?.totalUsers ?? null,
            deltaPercent: ga4.ga4Comparison?.changePercent.users ?? null,
          },
          clicks: {
            current: search.overview?.totalClicks ?? null,
            deltaPercent: search.comparison?.changePercent.clicks ?? null,
          },
          impressions: {
            current: search.overview?.totalImpressions ?? null,
            deltaPercent: search.comparison?.changePercent.impressions ?? null,
          },
          avgPosition: {
            current: search.overview?.avgPosition ?? null,
            // GSC's `change.position` is `current - previous` — negative means
            // rank improved (lower number = better). PulseStrip passes this
            // raw delta to <StatCard invertDelta>, which flips the color
            // semantics: negative→emerald (improvement), positive→red. Do
            // NOT pre-negate here; that would double-invert and render
            // improvements red.
            delta: search.comparison?.change.position ?? null,
          },
        }
      : null;

  // ── Data spread (wins/risks) — derived from all stories including headline ──
  const spreadColumns = (briefing && !isFree) ? buildSpread(briefing.stories, workspaceId, betaMode) : { wins: [], risks: [] };

  // ── Recommended for You — handler navigates to the strategy tab where the
  // existing brief-request flow lives. We keep the modal trigger out of this
  // composer (no new state machine in 2.5b); the strategy tab's content-gap
  // section has its own request flow that the user lands in.
  // Free-tier upgrade is handled by <TierGate>'s built-in 'tier-upgrade'
  // custom event — no inline callback needed here.
  const onRequestBrief = (rec: BriefingRecommendation) => {
    void rec;
    navigate(`${clientPath(workspaceId, 'strategy', betaMode)}?tab=content-gaps`);
  };

  // ── Free-tier branch: unchanged from Phase 2 ──
  if (isFree) {
    return (
      <div className="space-y-6">
        <ActionQueueStrip
          workspaceId={workspaceId}
          betaMode={betaMode}
          counts={actionCounts}
        />
        <FreeTierUpgradeCTA workspaceId={workspaceId} betaMode={betaMode} />
        {digestLoading ? (
          <LoadingState message="Loading your monthly highlights..." />
        ) : digest?.month ? (
          <MonthlyDigestContent digest={digest} />
        ) : null}
      </div>
    );
  }

  // ── Paid-tier loading ──
  if (isLoading) {
    return (
      <div className="space-y-6">
        <ActionQueueStrip
          workspaceId={workspaceId}
          betaMode={betaMode}
          counts={actionCounts}
          staleCount={staleness.staleCount}
          oldestDaysPending={staleness.oldestDaysPending}
        />
        <LoadingState message="Loading this week's briefing..." />
      </div>
    );
  }

  // ── Paid-tier empty (no briefing yet) ──
  if (!briefing || briefing.stories.length === 0) {
    return (
      <div className="space-y-6">
        <ActionQueueStrip
          workspaceId={workspaceId}
          betaMode={betaMode}
          counts={actionCounts}
          staleCount={staleness.staleCount}
          oldestDaysPending={staleness.oldestDaysPending}
        />
        <EmptyState
          icon={Sparkles}
          title="Your first briefing will arrive Monday"
          description="Each week we'll surface the wins, risks, and opportunities that matter — tailored to your business."
        />
      </div>
    );
  }

  // ── Paid-tier full magazine layout ──
  //
  // Per-user direction (post-2.5e): the single-story `<HeroStoryCard>`
  // spotlight is replaced with a monthly `<MonthlyDigestContent>`
  // snapshot — a high-level period overview matching the legacy
  // InsightsDigest UX clients were already accustomed to. The hero
  // story doesn't disappear: it folds back into the watch list below
  // so the in-depth deterministic story still surfaces. The Phase
  // 2.5e AI hero punch still mutates `stories[heroIdx].headline`
  // server-side; the punched headline now appears in the watch-list
  // row instead of the hero card.
  const allStories = briefing.stories;
  const recommendations: BriefingRecommendation[] = briefing.recommendations ?? [];
  const hasDigest = !!digest && !!digest.month;

  return (
    <div className="space-y-6">
      {/* Phase 2.5e — Premium-only AI weekly opener. Renders above the
          dateline when the wire response carries the field; otherwise
          omitted (free/growth tiers, flag off, fail-soft). */}
      {briefing.weeklyOpener && <WeeklyOpener text={briefing.weeklyOpener} />}
      <DateLine weekOf={briefing.weekOf} issueNumber={briefing.issueNumber} />
      <IssueSummaryLine text={briefing.issueSummary ?? ''} />
      <ActionQueueStrip
        workspaceId={workspaceId}
        betaMode={betaMode}
        counts={actionCounts}
        staleCount={staleness.staleCount}
        oldestDaysPending={staleness.oldestDaysPending}
      />
      <PulseStrip data={pulseData} isLoading={!pulseData && (ga4.isLoading || search.isLoading)} />
      {/* High-level snapshot — replaces the prior `<HeroStoryCard>` slot.
          Loading state during digest fetch; silently omitted if the
          backend returns the empty-digest sentinel (no `month`). */}
      {digestLoading ? (
        <LoadingState message="Loading this period's snapshot..." />
      ) : hasDigest ? (
        <MonthlyDigestContent digest={digest} />
      ) : null}
      {winsEnabled && (
        <WinsSurface workspaceId={workspaceId} effectiveTier={effectiveTier} />
      )}
      <DataSpread wins={spreadColumns.wins} risks={spreadColumns.risks} />
      <RecommendedForYou
        recommendations={recommendations}
        tier={effectiveTier}
        onRequestBrief={onRequestBrief}
      />
      {/* allStories is briefing.stories — the early-return at the top
          of the paid-tier block guarantees length ≥ 1 here, so no
          conditional wrapper is needed. */}
      <div className="border-t border-[var(--brand-border)] pt-4">
        <h3 className="t-label text-[var(--brand-text-bright)] tracking-wider mb-3 flex items-center gap-2">
          <Icon as={Sparkles} size="sm" className="text-accent-brand" />
          Also this week
        </h3>
        <div className="space-y-0">
          {allStories.map((s) => (
            <SecondaryStoryRow
              key={s.id}
              story={s}
              workspaceId={workspaceId}
              betaMode={betaMode}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Project the briefing's stories into wins/risks columns for the <DataSpread>
 * section. Pre-resolves drill-in URLs so spreadItemFromStory can stay a pure
 * helper. Caller is responsible for capping at 3 each (DataSpread does that
 * internally).
 */
function buildSpread(
  stories: BriefingStory[],
  workspaceId: string,
  betaMode: boolean,
): { wins: SpreadItem[]; risks: SpreadItem[] } {
  const wins: SpreadItem[] = [];
  const risks: SpreadItem[] = [];
  for (const story of stories) {
    const url = renderDrillInUrl(story, workspaceId, betaMode);
    const item = spreadItemFromStory(story, url ?? null);
    if (!item) continue;
    if (item.tone === 'win') wins.push(item);
    else risks.push(item);
  }
  return { wins, risks };
}

/**
 * Parse a possibly-string-or-number timestamp into ms epoch. Returns null
 * for malformed input rather than NaN, so callers can filter cleanly.
 */
function parseTs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Date.parse(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
