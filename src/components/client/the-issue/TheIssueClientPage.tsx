// ── TheIssueClientPage — the evergreen V2 client money surface ───────────────────
//
// Spec §5 / audit §16 (client). The reimagined client dashboard overview: an evergreen,
// continuously-current surface that LEADS WITH MEANING (proof → plan) and pushes detail
// behind progressive disclosure. Replaces the 12-section co-equal wall with a varied,
// editorial card rhythm. No admin jargon, no archetype/confidence/severity labels, no
// purple, no pricing UI, one decision per card.
//
// Sections in canonical order (audit blocker #2 re-sequence — plan LEADS, proof FOLLOWS):
//   1. Your turn          — pending-decisions strip (reuse ActionQueueStrip)
//   2. Narrated status     — evergreen headline + health chip + "curated by your strategist" byline
//   3. ⭐ Content plan      — the HERO money surface: value-first cards + Request this + 2-state floor
//   4. Also on your plan   — compact non-content moves, link out
//   5. Proof band          — ONE compressed band (numbers strip + ROI), collapsed behind a
//                            "See full report →" reveal (user action); ROI methodology kept
//   6. What's working      — evergreen proof (WinsSurface + OutcomeSummary + requested-kw trend)
//   7. How you stack up    — competitor snapshot (reuse CompetitorGapsSection)
//   8. Ask your strategist — advisor + the loop footer (greenlit / discussing)
//
// "Request this" = a content REQUEST (retainer greenlight); nothing is generated on the fly.
// Evergreen copy throughout (no time-relative language). Flag-OFF this file never mounts.
//
// `previewMode` (admin "Preview as client"): when true the surface mounts read-only —
// decision controls (act-on / feedback) are suppressed so the operator can preview safely.

import { ChevronDown, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ErrorBoundary } from '../../ErrorBoundary';
import { CompactStatBar, Skeleton, SectionCard, Icon } from '../../ui';
import type { Tier } from '../../ui/TierGate';
import type { Recommendation } from '../../../../shared/types/recommendations';
import type { ROIData } from '../../../../shared/types/roi';
import type { IssueOutcomeCount } from '../../../../shared/types/the-issue';
import type { ResolvedSegmentProfile } from '../../../../shared/types/workspace';
import { ActionQueueStrip } from '../Briefing/ActionQueueStrip';
import { ROIDashboard } from '../ROIDashboard';
import { CompetitorGapsSection } from '../CompetitorGapsSection';
import { WinsSurface } from '../Briefing/WinsSurface';
import OutcomeSummary from '../OutcomeSummary';
import { StrategyRequestedKeywordTrendSection } from '../strategy/StrategyRequestedKeywordTrendSection';
import { useStrategyTrackedKeywords } from '../strategy/useStrategyTrackedKeywords';
import { useStrategyKeywordFeedback } from '../strategy/useStrategyKeywordFeedback';
import { useClientContentRequests, useClientROI } from '../../../hooks/client';
import { useFeatureFlag } from '../../../hooks/useFeatureFlag';
import { clientPath } from '../../../routes';
import type { Archetype } from '../../../lib/recArchetypeMap';
import { QUICK_QUESTIONS } from '../types';
import type {
  SearchOverview, GA4Overview, GA4ConversionSummary, AuditSummary, ClientKeywordStrategy,
} from '../types';

import { NarratedStatusHeadline } from './NarratedStatusHeadline';
import { IssueVerdictHeadline } from './IssueVerdictHeadline';
import { OutcomeCountBand } from './OutcomeCountBand';
import { IssueExportBar } from './IssueExportBar';
import { IssueYourLeadsSection } from './IssueYourLeadsSection';
import { IssueContentPlanSection } from './IssueContentPlanSection';
import { IssueAlsoOnPlanSection } from './IssueAlsoOnPlanSection';
import { IssueLoopFooter } from './IssueLoopFooter';
import { useClientTheIssue } from './useClientTheIssue';
import { useActOnRecommendation } from '../../../hooks/client/useActOnRecommendation';
import { useClientRecResponses } from '../../../hooks/client/useClientRecResponses';
import { ISSUE_SECTION_TITLES } from './evergreenCopy';
import { DiagnosticRootCauseCards } from '../DiagnosticRootCauseCards';
import type { ClientDiagnosticSummary } from '../../../../shared/types/diagnostics';

const compact = (n: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export interface TheIssueClientPageProps {
  workspaceId: string;
  effectiveTier: Tier;
  betaMode: boolean;
  /** Pending-decisions counts for the "Your turn" strip. */
  actionCounts: {
    approvals: number;
    briefs: number;
    posts: number;
    replies: number;
    contentPlan: number;
  };
  /** Data for the status headline + stats bar + content floor. */
  overview: SearchOverview | null;
  ga4Overview: GA4Overview | null;
  ga4Conversions: GA4ConversionSummary[];
  audit: AuditSummary | null;
  strategyData: ClientKeywordStrategy | null;
  /** Advisor wiring (reuse the existing chat). */
  onAskAi: (q: string) => void;
  onOpenChat: () => void;
  /** Toast sink for act-on / feedback. */
  setToast?: (msg: string) => void;
  /** Admin "Preview as client": render read-only (decision controls suppressed). */
  previewMode?: boolean;
  // ── The Issue (Client) P0 spine — all additive/optional; unread on the flag-OFF path ──
  /** Server-assembled dollar/outcome verdict (slot 1). Falls back to useClientROI when absent. */
  outcomeVerdict?: ROIData['outcomeVerdict'] | null;
  /** Outcome counts in human units (slot 2), summed over pinned eventConfig events. */
  outcomeCount?: IssueOutcomeCount | null;
  /** Pre-resolved segment profile (authority-layered): drives the slot inserts. */
  segmentProfile?: ResolvedSegmentProfile | null;
  /** Test override for the spine flag. When provided, overrides useFeatureFlag (Rules-of-Hooks-safe). */
  theIssueClientSpine?: boolean;
  /** Completed client-safe diagnostic summaries shown on the Overview surface. */
  diagnosticReports?: ClientDiagnosticSummary[];
  /** P1b (Lane C) — test override for the return-hook flag (export bar + your-leads). When provided,
   *  overrides useFeatureFlag (Rules-of-Hooks-safe). Flag-OFF → neither P1b surface mounts. */
  theIssueReturnHook?: boolean;
  /** P1 (IA v2) — test override for the client-ia-v2 flag. When provided, overrides useFeatureFlag
   *  (Rules-of-Hooks-safe). Flag-OFF → MoM/typed hero clauses absent + leads stay under-the-hood. */
  iaV2?: boolean;
}

export function TheIssueClientPage({
  workspaceId,
  effectiveTier,
  betaMode,
  actionCounts,
  overview,
  ga4Overview,
  ga4Conversions,
  audit,
  strategyData,
  onAskAi,
  onOpenChat,
  setToast,
  previewMode = false,
  outcomeVerdict,
  outcomeCount,
  segmentProfile,
  theIssueClientSpine,
  diagnosticReports = [],
  theIssueReturnHook,
  iaV2,
}: TheIssueClientPageProps) {
  const navigate = useNavigate();

  // ── Hooks (ALL unconditional, before any early return — Rules of Hooks) ──────
  const issueQuery = useClientTheIssue(workspaceId);
  const { data: recResponses } = useClientRecResponses(workspaceId);
  const { trackedKeywords } = useStrategyTrackedKeywords({ workspaceId });
  const { getFeedbackStatus, submitFeedback } = useStrategyKeywordFeedback({ workspaceId, setToast });
  const { actOn, pendingRecId } = useActOnRecommendation({ workspaceId, setToast });
  const { data: contentRequests = [] } = useClientContentRequests(workspaceId, !!workspaceId);
  const { data: roiData } = useClientROI(workspaceId, !!workspaceId);

  // ── The Issue (Client) P0 spine flag — read unconditionally at the top (Rules of Hooks).
  //    An explicit prop override wins for deterministic component tests. ──────────
  const flagValue = useFeatureFlag('the-issue-client-spine');
  const spineEnabled = theIssueClientSpine ?? flagValue;
  // P1b (Lane C) — the return-hook flag gates the export bar + the client's own-leads view. Read
  // unconditionally at the top (Rules of Hooks); an explicit prop override wins for tests.
  const returnHookFlag = useFeatureFlag('the-issue-client-return-hook');
  const exportEnabled = theIssueReturnHook ?? returnHookFlag;
  // P1 (IA v2) — master flag for the verdict-first Overview reframe (MoM clause + typed hero +
  // surfaced leads). Read unconditionally at the top (Rules of Hooks); an explicit prop override
  // wins for deterministic component tests. Flag-OFF → every iaV2-gated change is byte-identical.
  const iaV2Flag = useFeatureFlag('client-ia-v2');
  const iaV2Enabled = iaV2 ?? iaV2Flag;
  // Verdict source: explicit prop wins; otherwise the public ROI payload (deduped React Query).
  const resolvedVerdict = outcomeVerdict !== undefined ? outcomeVerdict : (roiData?.outcomeVerdict ?? null);
  // Count-band source: prefer the server verdict's snapshot-based typed breakdown so each per-type
  // card carries the SAME baseline/prior month-over-month as the headline. The `outcomeCount` prop
  // is assembled client-side from LIVE GA4 (which has no history), so its per-type cards otherwise
  // read "establishing your baseline" even when the verdict shows a real delta — a contradiction.
  // Falls back to the prop when the verdict carries no typed breakdown (measured-capture OFF / none).
  const verdictBreakdown = resolvedVerdict?.outcomeTypeBreakdown;
  const resolvedOutcomeCount: IssueOutcomeCount | null =
    verdictBreakdown && verdictBreakdown.length > 0
      ? {
          units: verdictBreakdown.map((t) => ({
            label: t.label,
            current: t.current,
            baseline: t.baseline,
            priorPeriod: t.priorPeriod,
            outcomeType: t.outcomeType,
          })),
          byType: verdictBreakdown,
          provenance: resolvedVerdict?.provenance ?? 'estimate_ga4',
          namedRecordsAvailable: outcomeCount?.namedRecordsAvailable ?? false,
        }
      : (outcomeCount ?? null);
  // Default-visible preserves the current surface when the segment is unresolved.
  const showCompetitor = segmentProfile?.showCompetitorAuthority ?? true;

  const recs = issueQuery.data?.recommendations ?? [];
  const topRecId = issueQuery.data?.summary?.topRecommendationId ?? null;
  const topRec = topRecId != null ? recs.find((r) => r.id === topRecId) ?? null : null;
  const orient = strategyData?.strategyUx?.orient;

  // Work-in-flight: briefs the agency is actively working (requested / generated / in-progress).
  const briefsInProgress = contentRequests.filter(
    (r) => r.status === 'requested' || r.status === 'brief_generated' || r.status === 'in_progress',
  ).length;

  // Preview mode: suppress decision controls (no act-on / feedback writes from a preview).
  const onActOn = previewMode ? () => {} : actOn;
  const handleRelevant = (kw: string) => { if (!previewMode) void submitFeedback(kw, 'approved', 'the-issue-content'); };
  const handleNotRelevant = (kw: string) => { if (!previewMode) void submitFeedback(kw, 'declined', 'the-issue-content'); };
  // In-card soft-yes (audit blocker #1): open the advisor pre-seeded with the move
  // (title + targetKeyword) — same open-chat-then-ask pattern the loop footer uses.
  const handleLetsTalk = (rec: Recommendation) => {
    if (previewMode) return;
    const kw = rec.targetKeyword ? ` (target keyword: ${rec.targetKeyword})` : '';
    onOpenChat();
    setTimeout(() => onAskAi(`I'd like to talk through this move: "${rec.title}"${kw}.`), 100);
  };
  // IA v2: the strategy CTAs land in Deep Dive › Rankings (the folded home of the
  // keyword/strategy surfaces); flag-OFF they keep the standalone Strategy tab.
  // `sub=rankings` selects the Deep Dive sub-tab; `tab=rankings` selects the nested
  // StrategyTab's own interior Rankings tab (it reads ?tab=, default 'overview') — both
  // are needed or the user lands on StrategyTab's Overview interior tab instead.
  const strategyDest = () => iaV2Enabled
    ? `${clientPath(workspaceId, 'deep-dive', betaMode)}?sub=rankings&tab=rankings`
    : clientPath(workspaceId, 'strategy', betaMode);
  const openStrategy = () => navigate(strategyDest());
  const openGroup = (_archetype: Archetype) => navigate(strategyDest());

  // ── Loading state (real loading→loaded transition; hooks already ran) ────────
  if (issueQuery.isLoading) {
    return (
      <ErrorBoundary>
        <div className="space-y-4" data-testid="the-issue-loading">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </ErrorBoundary>
    );
  }

  // ── Stats bar items (simple; + conversions). Blue = data per the Four Laws. ──
  const conversionsTotal = ga4Conversions.reduce((sum, c) => sum + (c.conversions ?? 0), 0);
  const statItems = [
    ga4Overview && { label: 'Visitors', value: compact(ga4Overview.totalUsers), valueColor: 'text-blue-400' },
    overview && { label: 'Search clicks', value: compact(overview.totalClicks), valueColor: 'text-blue-400' },
    overview && { label: 'Impressions', value: compact(overview.totalImpressions), valueColor: 'text-blue-400' },
    orient && orient.rankedKeywords > 0 && { label: 'Avg position', value: `#${orient.avgPosition.toFixed(1)}`, valueColor: 'text-blue-400' },
    audit && { label: 'Site health', value: `${audit.siteScore}`, valueColor: 'text-blue-400' },
    conversionsTotal > 0 && { label: 'Conversions', value: compact(conversionsTotal), valueColor: 'text-blue-400' },
  ].filter(Boolean) as { label: string; value: string; valueColor: string }[];

  // ── The Issue (Client) P0 spine (flag ON) — verdict-first trust spine ─────────
  // Slot 0 Your turn → 1 Verdict → 2 Outcome count → 3 Money (un-collapsed) →
  // 4 What needs me → 5 Content plan (demoted) → 6 Under the hood (collapsed; the ring lives here).
  if (spineEnabled) {
    return (
      <ErrorBoundary>
        <div className="space-y-6" data-testid="the-issue-client-page">
          {/* 0. Your turn — pending decisions (reuse ActionQueueStrip; renders null when empty). */}
          {!previewMode && (
            <ActionQueueStrip workspaceId={workspaceId} betaMode={betaMode} counts={actionCounts} />
          )}

          <DiagnosticRootCauseCards workspaceId={workspaceId} reports={diagnosticReports} />

          {/* 1. Verdict — the dollar/outcome lead (no ring). */}
          <ErrorBoundary label="Verdict">
            <div data-testid="slot-verdict">
              <IssueVerdictHeadline verdict={resolvedVerdict ?? null} topRec={topRec} iaV2={iaV2Enabled} />
            </div>
          </ErrorBoundary>

          {/* P1b (Lane C) — the forwardable one-pager affordance. Gated on the-issue-client-return-hook
              (flag OFF → not mounted → byte-identical). NOT tier-gated (DR-5). */}
          {exportEnabled && (
            <ErrorBoundary label="One-pager export">
              <IssueExportBar
                workspaceId={workspaceId}
                previewMode={previewMode}
                segmentProfile={segmentProfile}
              />
            </ErrorBoundary>
          )}

          {/* 2. Outcome count — outcomes in human units (only when there are pinned events). */}
          {resolvedOutcomeCount && (
            <ErrorBoundary label="Outcome count">
              <div data-testid="slot-outcome-count">
                <OutcomeCountBand count={resolvedOutcomeCount} />
              </div>
            </ErrorBoundary>
          )}

          {/* 2.5 Your leads — surfaced directly under the count when IA v2 (the check-signer's
              "show me the N people behind these numbers"). Gated on the return-hook flag; suppressed
              in admin preview (client PII is not the operator's). When iaV2 OFF this stays in the
              collapsed "Under the hood" block below (byte-identical). */}
          {iaV2Enabled && exportEnabled && !previewMode && (
            <ErrorBoundary label="Your captured leads">
              <IssueYourLeadsSection workspaceId={workspaceId} />
            </ErrorBoundary>
          )}

          {/* 3. Money frame — UN-COLLAPSED (no <details>), compact (tables relocate to slot 6). */}
          <ErrorBoundary label="What your SEO is worth">
            <div data-testid="slot-money" className="space-y-3">
              <h2 className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">{ISSUE_SECTION_TITLES.roi}</h2>
              <ROIDashboard workspaceId={workspaceId} tier={effectiveTier} evergreen compact />
            </div>
          </ErrorBoundary>

          {/* 4. What needs me — the full pending-decisions queue / loop. */}
          {previewMode ? (
            <SectionCard title={ISSUE_SECTION_TITLES.ask}>
              <p className="t-body text-[var(--brand-text-muted)]">
                In the live dashboard, your client can ask their strategist a question here and see the moves they’ve greenlit.
              </p>
            </SectionCard>
          ) : (
            <ErrorBoundary label="Ask your strategist">
              <IssueLoopFooter
                responses={recResponses}
                briefsInProgress={briefsInProgress}
                quickQuestions={QUICK_QUESTIONS}
                onOpenChat={onOpenChat}
                onAskAi={onAskAi}
              />
            </ErrorBoundary>
          )}

          {/* 5. Content plan — DEMOTED below the proof/money band (positional, nothing cut). */}
          <ErrorBoundary label="Content plan">
            <div data-testid="slot-content-plan">
              <IssueContentPlanSection
                recs={recs}
                strategyData={strategyData}
                tier={effectiveTier}
                getFeedbackStatus={getFeedbackStatus}
                onRelevant={handleRelevant}
                onNotRelevant={handleNotRelevant}
                onActOn={onActOn}
                pendingRecId={pendingRecId}
                onLetsTalk={handleLetsTalk}
                onSeeDetails={openStrategy}
              />
            </div>
          </ErrorBoundary>
          <ErrorBoundary label="Also on your plan">
            <IssueAlsoOnPlanSection recs={recs} onOpenGroup={openGroup} />
          </ErrorBoundary>

          {/* What's working right now — evergreen proof (Wins). */}
          <div className="space-y-4">
            {/* duplicate-heading-ok: this is the spine-ON branch; the flag-OFF branch below renders the same section title, but the two are mutually exclusive at runtime and the OFF branch must stay byte-identical. */}
            <h2 className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">{ISSUE_SECTION_TITLES.whatsWorking}</h2>
            <ErrorBoundary label="Wins">
              <WinsSurface workspaceId={workspaceId} effectiveTier={effectiveTier} />
            </ErrorBoundary>
            <ErrorBoundary label="Your results">
              <OutcomeSummary workspaceId={workspaceId} tier={effectiveTier} />
            </ErrorBoundary>
            <ErrorBoundary label="Requested keyword trend">
              <StrategyRequestedKeywordTrendSection
                workspaceId={workspaceId}
                trackedKeywords={trackedKeywords}
                effectiveTier={effectiveTier}
              />
            </ErrorBoundary>
          </div>

          {/* P1 insert points — gated now so the segment wiring contract exists (built in P1). */}
          {segmentProfile?.showLocalMapAndReviews && null /* P1 local map + reviews insert */}
          {segmentProfile?.showPortfolioRollup && null /* P1 portfolio rollup insert */}

          {/* 6. Under the hood — collapsed. The visibility ring + the numbers strip + the
              relocated ROI tables + (segment-gated) competitor snapshot live here now. */}
          <ErrorBoundary label="Under the hood">
            <details className="group bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-signature)] overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 [&::-webkit-details-marker]:hidden">
                <span className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">Under the hood</span>
                <span className="inline-flex items-center gap-1 t-caption-sm text-accent-brand flex-shrink-0">
                  See the full picture
                  <Icon as={ChevronDown} size="sm" className="transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <div className="px-4 pb-4 pt-1 space-y-4">
                <NarratedStatusHeadline orient={orient} topRec={topRec} statedGoal={strategyData?.businessContext} />
                {statItems.length > 0 && <CompactStatBar items={statItems} />}
                <ROIDashboard workspaceId={workspaceId} tier={effectiveTier} evergreen compact={false} />
                {/* P1b (Lane C) — the client's OWN captured leads (authed surface only). Gated on the
                    return-hook flag; suppressed in admin preview (client PII is not the operator's).
                    P1 (IA v2): when iaV2 ON the leads section is surfaced above (slot 2.5), so guard
                    this under-the-hood mount on !iaV2Enabled to avoid a double-mount. */}
                {!iaV2Enabled && exportEnabled && !previewMode && (
                  <ErrorBoundary label="Your captured leads">
                    <IssueYourLeadsSection workspaceId={workspaceId} />
                  </ErrorBoundary>
                )}
                {showCompetitor && (
                  <ErrorBoundary label="Competitors">
                    <CompetitorGapsSection workspaceId={workspaceId} tier={effectiveTier} />
                  </ErrorBoundary>
                )}
              </div>
            </details>
          </ErrorBoundary>
        </div>
      </ErrorBoundary>
    );
  }

  // ── Flag-OFF path — the CURRENT layout, byte-identical (do NOT refactor) ──────
  return (
    <ErrorBoundary>
      <div className="space-y-6" data-testid="the-issue-client-page">
        {/* 1. Your turn — pending decisions (reuse ActionQueueStrip; renders null when empty). */}
        {!previewMode && (
          <ActionQueueStrip workspaceId={workspaceId} betaMode={betaMode} counts={actionCounts} />
        )}

        <DiagnosticRootCauseCards workspaceId={workspaceId} reports={diagnosticReports} />

        {/* 2. Narrated status headline (health chip lives in the ring) + the "curated by your
            strategist" byline sub-line — makes the human-curation moat visible at the top. */}
        <div>
          <NarratedStatusHeadline orient={orient} topRec={topRec} statedGoal={strategyData?.businessContext} />
          <p className="mt-2 inline-flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)]">
            <Icon as={Sparkles} size="sm" className="text-accent-brand" />
            Curated by your strategist
          </p>
        </div>

        {/* 3. ⭐ Content plan — the HERO (the money). Value-first cards + Request this + floor. */}
        <ErrorBoundary label="Content plan">
          <IssueContentPlanSection
            recs={recs}
            strategyData={strategyData}
            tier={effectiveTier}
            getFeedbackStatus={getFeedbackStatus}
            onRelevant={handleRelevant}
            onNotRelevant={handleNotRelevant}
            onActOn={onActOn}
            pendingRecId={pendingRecId}
            onLetsTalk={handleLetsTalk}
            onSeeDetails={openStrategy}
          />
        </ErrorBoundary>

        {/* 4. Also on your plan — compact non-content moves, link out. */}
        <ErrorBoundary label="Also on your plan">
          <IssueAlsoOnPlanSection recs={recs} onOpenGroup={openGroup} />
        </ErrorBoundary>

        {/* 5. ONE compressed proof band — numbers strip + ROI merged, collapsed behind a
            "See full report →" reveal that requires a user action (the <details> toggle). The
            ROI methodology disclosure is kept (moved, not dropped); the temporal MoM stat is
            suppressed via evergreen. Replaces the two co-equal "Your numbers" + ROI sections. */}
        <ErrorBoundary label="Your proof">
          <details className="group bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-signature)] overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 [&::-webkit-details-marker]:hidden">
              <div className="min-w-0 flex-1">
                <span className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">{ISSUE_SECTION_TITLES.roi}</span>
                {statItems.length > 0 && (
                  <div className="mt-2">
                    <CompactStatBar items={statItems} />
                  </div>
                )}
              </div>
              <span className="inline-flex items-center gap-1 t-caption-sm text-accent-brand flex-shrink-0">
                See full report
                <Icon as={ChevronDown} size="sm" className="transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="px-4 pb-4 pt-1">
              <ROIDashboard workspaceId={workspaceId} tier={effectiveTier} evergreen />
            </div>
          </details>
        </ErrorBoundary>

        {/* 6. What's working right now — evergreen proof (Wins). */}
        <div className="space-y-4">
          <h2 className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">{ISSUE_SECTION_TITLES.whatsWorking}</h2>
          <ErrorBoundary label="Wins">
            <WinsSurface workspaceId={workspaceId} effectiveTier={effectiveTier} />
          </ErrorBoundary>
          <ErrorBoundary label="Your results">
            <OutcomeSummary workspaceId={workspaceId} tier={effectiveTier} />
          </ErrorBoundary>
          <ErrorBoundary label="Requested keyword trend">
            <StrategyRequestedKeywordTrendSection
              workspaceId={workspaceId}
              trackedKeywords={trackedKeywords}
              effectiveTier={effectiveTier}
            />
          </ErrorBoundary>
        </div>

        {/* 7. How you stack up — competitor snapshot (reuse). */}
        <ErrorBoundary label="Competitors">
          <CompetitorGapsSection workspaceId={workspaceId} tier={effectiveTier} />
        </ErrorBoundary>

        {/* 8. Ask your strategist + the loop footer. */}
        {previewMode ? (
          <SectionCard title={ISSUE_SECTION_TITLES.ask}>
            <p className="t-body text-[var(--brand-text-muted)]">
              In the live dashboard, your client can ask their strategist a question here and see the moves they’ve greenlit.
            </p>
          </SectionCard>
        ) : (
          <ErrorBoundary label="Ask your strategist">
            <IssueLoopFooter
              responses={recResponses}
              briefsInProgress={briefsInProgress}
              quickQuestions={QUICK_QUESTIONS}
              onOpenChat={onOpenChat}
              onAskAi={onAskAi}
            />
          </ErrorBoundary>
        )}
      </div>
    </ErrorBoundary>
  );
}
