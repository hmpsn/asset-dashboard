// src/components/client/Briefing/WinsSurface.tsx
import { Sparkles } from 'lucide-react';
import { SectionCard, Skeleton, Icon, EmptyState } from '../../ui';
import { TierGate } from '../../ui/TierGate';
import { useClientOutcomeWins } from '../../../hooks/client/useClientOutcomes';
import { timeAgo } from '../../../lib/timeAgo';
import { clientActionLabel } from '../../../../shared/types/client-vocabulary';
import type { Tier } from '../../ui/TierGate';
import type { OutcomeWinEntry, OutcomeScore } from '../../../../shared/types/outcome-tracking';

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
  const heading = entry.recommendation || clientActionLabel(entry.actionType);

  // C4 (attribution honesty): an `externally_executed` win is work done on the CLIENT's
  // side that we flagged/called — not something we shipped. Never let the row imply we
  // executed it; add an honest "implemented on your side" qualifier. `platform_executed`
  // rows carry no qualifier (the card title already frames them as our shipped work).
  const isExternal = entry.attribution === 'externally_executed';

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
        {isExternal && (
          <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
            We flagged this — implemented on your side.
          </p>
        )}
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

  // C4 (attribution honesty): "What we shipped" is only true when every win is
  // platform-executed. Once the list includes an externally_executed win (work done on
  // the client's side that we flagged), the honest umbrella is "Wins we called" — the
  // per-row qualifier then clarifies which side implemented each one.
  const hasExternal = wins.some(w => w.attribution === 'externally_executed');
  const cardTitle = hasExternal ? 'Wins we called' : 'What we shipped';

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
      title={cardTitle}
      titleIcon={<Icon as={Sparkles} size="md" className="text-accent-brand" />}
    >
      {effectiveTier === 'free' ? (() => {
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const thisMonthCount = wins.filter(w => now - new Date(w.detectedAt).getTime() <= thirtyDaysMs).length;
        // C4: "what we built" overclaims execution when externally_executed wins are present.
        // "your wins" is honest regardless of who implemented each one.
        const teaserStr = thisMonthCount > 0
          ? `${thisMonthCount} win${thisMonthCount === 1 ? '' : 's'} in the last 30 days — upgrade to see your wins.`
          : 'Wins are being tracked — upgrade to see your wins.';
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
