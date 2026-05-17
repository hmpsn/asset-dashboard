// src/components/client/Briefing/WinsSurface.tsx
import { Sparkles } from 'lucide-react';
import { SectionCard, Skeleton, Icon, EmptyState } from '../../ui';
import { TierGate } from '../../ui/TierGate';
import { useClientOutcomeWins } from '../../../hooks/client/useClientOutcomes';
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
};

function actionLabel(type: ActionType): string {
  return ACTION_LABELS[type] ?? type.replace(/_/g, ' ');
}

// ── Relative time ──────────────────────────────────────────────────────────

function relativeTime(isoDate: string): string {
  const diff = Math.max(0, Date.now() - new Date(isoDate).getTime());
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30.44); // 30.44 ≈ avg days/month
  return months === 1 ? '1 month ago' : `${months} months ago`;
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

  return (
    <div className="flex items-start gap-3 py-3 border-b border-[var(--brand-border)] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="t-ui font-medium text-[var(--brand-text-bright)]">{actionLabel(entry.actionType)}</span>
          <ScoreBadge score={entry.score} />
        </div>
        {pageLabel && (
          <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 truncate">{pageLabel}</p>
        )}
        <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
          {entry.delta.primary_metric}: <span className="text-accent-success font-medium">{deltaStr}</span>
        </p>
      </div>
      <span className="t-caption text-[var(--brand-text-muted)] flex-shrink-0 pt-0.5">{relativeTime(entry.detectedAt)}</span>
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
          {wins.length === 10 && (
            <a
              href="#"
              title="Coming soon"
              className="block mt-3 t-caption text-accent-brand hover:text-[var(--brand-text-bright)] transition-colors"
              onClick={e => e.preventDefault()}
            >
              See full history →
            </a>
          )}
        </>
      )}
    </>
  );

  return (
    <SectionCard
      title="What we shipped"
      titleIcon={<Icon as={Sparkles} size="md" className="text-accent-brand" />}
    >
      {effectiveTier === 'free' ? (
        <TierGate
          tier={effectiveTier}
          required="growth"
          feature="Wins ledger"
          teaser={`${wins.length} wins shipped this month — upgrade to see what we built.`}
        >
          {body}
        </TierGate>
      ) : (
        body
      )}
    </SectionCard>
  );
}
