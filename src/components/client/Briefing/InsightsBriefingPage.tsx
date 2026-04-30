// CLIENT-FACING
// Composes the magazine briefing on the client Insights tab — Phase 2.5b.
//
// 8-stop reading rhythm (paid tier):
//   DateLine → IssueSummaryLine → ActionQueueStrip → PulseStrip
//     → HeroStoryCard → DataSpread → RecommendedForYou → SecondaryStoryRow list
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
  useClientContentPlan,
  useClientAuditSummary,
} from '../../../hooks/client';
import { useClientGA4 } from '../../../hooks/client/useClientGA4';
import { useClientSearch } from '../../../hooks/client/useClientSearch';
import { clientPath } from '../../../routes';
import type { BriefingRecommendation, BriefingStory } from '../../../../shared/types/briefing';
import { ActionQueueStrip, computeStaleness } from './ActionQueueStrip';
import { HeroStoryCard } from './HeroStoryCard';
import { SecondaryStoryRow } from './SecondaryStoryRow';
import { FreeTierUpgradeCTA } from './FreeTierUpgradeCTA';
import { MonthlyDigestContent } from '../MonthlyDigest';
import { DateLine } from './DateLine';
import { IssueSummaryLine } from './IssueSummaryLine';
import { PulseStrip, type PulseStripData } from './PulseStrip';
import { DataSpread, spreadItemFromStory, type SpreadItem } from './DataSpread';
import { RecommendedForYou } from './RecommendedForYou';
import { renderDrillInUrl } from './drillIn';

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

  // ── Briefing draft (paid only) ──
  const { data: briefing, isLoading } = useClientBriefing(workspaceId, !isFree);

  // ── Free-tier digest tease ──
  const { data: digest, isLoading: digestLoading } = useMonthlyDigest(isFree ? workspaceId : '');

  // ── Pulse data sources (paid only) ──
  // Audit summary drives Site Health; GSC drives clicks/impressions/avg-position;
  // GA4 drives Visitors. All hooks share the global staleTime so this composer
  // shares cache with other paid-tier views (Performance, Strategy).
  const { data: audit } = useClientAuditSummary(workspaceId, !isFree);
  const ga4 = useClientGA4(workspaceId, PULSE_DAYS, undefined, !isFree);
  const search = useClientSearch(workspaceId, PULSE_DAYS, undefined, !isFree);

  // ── Stale-item escalation sources (paid only) ──
  // Each hook returns timestamped raw items. The composer computes staleness
  // (>7d age) for the action strip's escalation pill. Free tier skips this —
  // the strip would render but with no escalation.
  const { data: approvals = [] } = useClientApprovals(workspaceId, !isFree);
  const { data: contentRequests = [] } = useClientContentRequests(workspaceId, !isFree);
  const { data: contentPlan } = useClientContentPlan(workspaceId, !isFree);

  // Approvals expose `createdAt` (ISO string) — convert to ms epoch.
  // Content requests expose `createdAt` (ISO). Content-plan review cells don't
  // expose timestamps via the public endpoint today; fall back to "no stale
  // signal" for that bucket. (When the public endpoint surfaces cell timestamps,
  // it lands here without a prop change.)
  const staleTimestamps: number[] = [];
  for (const a of approvals) {
    const ts = parseTs((a as { createdAt?: string | number }).createdAt);
    if (ts !== null) staleTimestamps.push(ts);
  }
  for (const r of contentRequests) {
    if (r.status === 'client_review' || r.status === 'post_review') {
      const ts = parseTs((r as { createdAt?: string | number }).createdAt);
      if (ts !== null) staleTimestamps.push(ts);
    }
  }
  const staleness = computeStaleness(staleTimestamps);
  // contentPlan.summary.reviewCells contributes count but no timestamp; if any
  // are present we still want at least baseline staleness (assume just-now,
  // safe default). We deliberately do not estimate ages we don't know.
  void contentPlan;

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
            // GSC change.position is the raw delta (current - previous). Lower
            // position is better, so the StatCard's invertDelta=true flips the
            // sign for color rendering. We pass the raw delta unchanged.
            delta:
              search.comparison?.change.position != null
                ? -search.comparison.change.position // negate so positive = improvement
                : null,
          },
        }
      : null;

  // ── Data spread (wins/risks) — derived from non-headline stories ──
  const spreadColumns = (briefing && !isFree) ? buildSpread(briefing.stories, workspaceId, betaMode) : { wins: [], risks: [] };

  // ── Recommended for You — handler navigates to the strategy tab where the
  // existing brief-request flow lives. We keep the modal trigger out of this
  // composer (no new state machine in 2.5b); the strategy tab's content-gap
  // section has its own request flow that the user lands in.
  const onRequestBrief = (rec: BriefingRecommendation) => {
    void rec;
    navigate(`${clientPath(workspaceId, 'strategy', betaMode)}?tab=content-gaps`);
  };
  const onUpgrade = () => {
    navigate(`${clientPath(workspaceId, 'inbox', betaMode)}?tab=upgrade`);
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
  // Two passes (find + filter) instead of three .filter() iterations. Phase 1
  // Zod enforces exactly 1 headline story per briefing.
  const hero = briefing.stories.find((s) => s.isHeadline);
  const secondary = briefing.stories.filter((s) => !s.isHeadline);
  const recommendations: BriefingRecommendation[] = briefing.recommendations ?? [];

  return (
    <div className="space-y-6">
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
      {hero && (
        <HeroStoryCard
          key={hero.id}
          story={hero}
          workspaceId={workspaceId}
          betaMode={betaMode}
        />
      )}
      <DataSpread wins={spreadColumns.wins} risks={spreadColumns.risks} />
      <RecommendedForYou
        recommendations={recommendations}
        tier={effectiveTier}
        onRequestBrief={onRequestBrief}
        onUpgrade={onUpgrade}
      />
      {secondary.length > 0 && (
        <div className="border-t border-[var(--brand-border)] pt-4">
          <h3 className="t-label text-[var(--brand-text-muted)] tracking-wider mb-3 flex items-center gap-2">
            <Icon as={Sparkles} size="sm" className="text-teal-400" />
            Also this week
          </h3>
          <div className="space-y-0">
            {secondary.map((s) => (
              <SecondaryStoryRow
                key={s.id}
                story={s}
                workspaceId={workspaceId}
                betaMode={betaMode}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Project the briefing's non-headline stories into wins/risks columns for the
 * <DataSpread> section. Pre-resolves drill-in URLs so spreadItemFromStory can
 * stay a pure helper. Caller is responsible for capping at 3 each (DataSpread
 * does that internally).
 */
function buildSpread(
  stories: BriefingStory[],
  workspaceId: string,
  betaMode: boolean,
): { wins: SpreadItem[]; risks: SpreadItem[] } {
  const wins: SpreadItem[] = [];
  const risks: SpreadItem[] = [];
  for (const story of stories) {
    if (story.isHeadline) continue;
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
