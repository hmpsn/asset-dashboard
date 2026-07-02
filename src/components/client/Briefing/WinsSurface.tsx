// src/components/client/Briefing/WinsSurface.tsx
import { Sparkles } from 'lucide-react';
import { SectionCard, Skeleton, Icon, EmptyState } from '../../ui';
import { TierGate } from '../../ui/TierGate';
import { useClientOutcomeWins } from '../../../hooks/client/useClientOutcomes';
import { timeAgo } from '../../../lib/timeAgo';
import type { Tier } from '../../ui/TierGate';
import type { ActionType, OutcomeWinEntry, OutcomeScore } from '../../../../shared/types/outcome-tracking';

// ── Action type → human label ───────────────────────────────────────────────

const ACTION_LABELS: Record<ActionType, string> = {
  meta_updated:           'Updated meta description',
  content_published:      'Published new post',
  content_refreshed:      'Refreshed existing content',
  schema_deployed:        'Added structured data',
  internal_link_added:    'Added internal links',
  audit_fix_applied:      'Fixed audit issue',
  brief_created:          'Created content brief',
  strategy_keyword_added: 'Added keyword to strategy',
  voice_calibrated:       'Calibrated brand voice',
  insight_acted_on:       'Acted on a recommendation',
  competitor_gap_closed:  'Closed a competitor keyword gap',
  cluster_published:      'Filled a topic cluster',
  cannibalization_resolved: 'Resolved keyword cannibalization',
  local_visibility_won:   'Won local pack visibility',
  local_service_added:    'Started targeting a local service',
  // Strategy redesign P2 pre-commit — managed-set keep markers (internal curation, never
  // recorded as a client-facing outcome; present only to keep this Record exhaustive).
  topic_cluster_keep:     'Prioritized a topic cluster',
  content_gap_keep:       'Prioritized a content opportunity',
  // Reconcile R8-PR1 (B13) — ships dark; see shared/types/outcome-tracking.ts.
  gbp_review_reply:       'Replied to a Google Business Profile review',
};

function actionLabel(type: ActionType): string {
  return ACTION_LABELS[type] ?? type.replace(/_/g, ' ');
}

// ── Win quality badge ──────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: OutcomeScore }) {
  if (score === 'strong_win') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] badge-span-ok t-caption-sm font-medium bg-emerald-500/15 text-accent-success border border-emerald-500/30">
        Strong win
      </span>
    );
  }
  // "Win" is a success-status badge — not a CTA — so emerald/neutral, not teal (Four Laws: teal = actions only)
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] badge-span-ok t-caption-sm font-medium bg-emerald-500/8 text-[var(--brand-text-bright)] border border-emerald-500/20">
      Win
    </span>
  );
}

// ── Win row ────────────────────────────────────────────────────────────────

function WinRow({ entry }: { entry: OutcomeWinEntry }) {
  const pageLabel = entry.targetKeyword
    ? `"${entry.targetKeyword}"`
    : entry.pageUrl
      ? entry.pageUrl.replace(/^https?:\/\/[^/]+/, '') || '/'
      : null;

  const deltaSign = entry.delta.delta_absolute >= 0 ? '+' : '';
  const pctSign = entry.delta.delta_percent >= 0 ? '+' : '';
  const deltaStr = `${deltaSign}${entry.delta.delta_absolute.toFixed(1)} (${pctSign}${entry.delta.delta_percent.toFixed(1)}%)`;

  // E5: the server resolves the real source title (recommendation/post/brief) into
  // `recommendation`, falling back to an honest generic. Older cached entries may
  // carry an empty string — fall back to the action-type label locally.
  const heading = entry.recommendation || actionLabel(entry.actionType);

  // Realized dollar attribution (action_outcomes.attributed_value). Blue = data
  // per the Four Laws — this is a read-only metric, not a CTA.
  const showValue = typeof entry.attributedValue === 'number' && entry.attributedValue > 0;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-[var(--brand-border)] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="t-ui font-medium text-[var(--brand-text-bright)]">{heading}</span>
          <ScoreBadge score={entry.score} />
        </div>
        {pageLabel && (
          <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 truncate">{pageLabel}</p>
        )}
        <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
          {entry.delta.primary_metric}: <span className="text-accent-success font-medium">{deltaStr}</span>
          {showValue && (
            <>
              {' · '}
              <span className="text-accent-info font-medium">≈ ${Math.round(entry.attributedValue!).toLocaleString()} in added traffic value</span>
            </>
          )}
        </p>
      </div>
      <span className="t-caption text-[var(--brand-text-muted)] flex-shrink-0 pt-0.5">{timeAgo(entry.detectedAt, { style: 'calendar' })}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface WinsSurfaceProps {
  workspaceId: string;
  effectiveTier: Tier;
}

export function WinsSurface({ workspaceId, effectiveTier }: WinsSurfaceProps) {
  const { data: wins = [], isLoading, isError } = useClientOutcomeWins(workspaceId);

  // Hide entirely until there are real wins to show — no empty-state card.
  // Loading skeleton still renders so layout doesn't shift on first paint.
  if (!isLoading && !isError && wins.length === 0) return null;

  const body = (
    <>
      {isLoading && (
        <div className="space-y-3 py-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {!isLoading && isError && (
        <p className="t-caption text-[var(--brand-text-muted)] py-4">
          Couldn't load wins — try refreshing the page.
        </p>
      )}
      {!isLoading && !isError && wins.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title="Wins are building"
          description="We're working — wins appear here once your changes start showing measurable impact."
        />
      )}
      {!isLoading && !isError && wins.length > 0 && (
        <>
          <div>
            {wins.map(w => <WinRow key={w.actionId} entry={w} />)}
          </div>
        </>
      )}
    </>
  );

  return (
    <SectionCard
      title="What we shipped"
      titleIcon={<Icon as={Sparkles} size="md" className="text-accent-brand" />}
    >
      {effectiveTier === 'free' ? (() => {
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const thisMonthCount = wins.filter(w => now - new Date(w.detectedAt).getTime() <= thirtyDaysMs).length;
        const teaserStr = thisMonthCount > 0
          ? `${thisMonthCount} win${thisMonthCount === 1 ? '' : 's'} in the last 30 days — upgrade to see what we built.`
          : 'Wins are being tracked — upgrade to see what we built.';
        return (
          <TierGate
            tier={effectiveTier}
            required="growth"
            feature="Wins ledger"
            teaser={teaserStr}
          >
            {body}
          </TierGate>
        );
      })() : (
        body
      )}
    </SectionCard>
  );
}
