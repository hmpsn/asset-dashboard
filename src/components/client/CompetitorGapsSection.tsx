// ── Competitor gaps (Premium) ──────────────────────────────────────────────
// Client-facing competitor benchmarking surface (Client Revenue R2 §3 / §4a).
//
// Shows, per keyword, the "you vs them" gap: keywords a named competitor ranks
// for that this site is missing — with banded/labeled opportunity value (never
// raw provider numbers, never money). Premium-exclusive: Growth/free see a
// soft-gate upsell via <TierGate>; the server enforces the same gate (402),
// so the data never reaches a non-Premium client even if the UI is bypassed.
//
// Client-insight rules: narrative framing, no admin jargon, no purple. The
// opportunity bands use data/score tones (emerald/amber/zinc), not actions.

import { Target, Users, Lock } from 'lucide-react';
import { SectionCard, EmptyState, Badge, TierGate, LoadingState, ErrorState, type Tier } from '../ui';
import { useClientCompetitorGaps } from '../../hooks/client';
import type {
  ClientCompetitorGap,
  CompetitorGapOpportunityBand,
} from '../../../shared/types/competitor-gaps';

interface CompetitorGapsSectionProps {
  workspaceId: string;
  tier: Tier;
}

const BAND_BADGE: Record<CompetitorGapOpportunityBand, { tone: 'emerald' | 'amber' | 'zinc'; label: string }> = {
  high: { tone: 'emerald', label: 'High opportunity' },
  medium: { tone: 'amber', label: 'Worth a look' },
  low: { tone: 'zinc', label: 'Lower priority' },
};

function GapRow({ gap }: { gap: ClientCompetitorGap }) {
  const band = BAND_BADGE[gap.opportunityBand];
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{gap.keyword}</span>
          <Badge tone={band.tone} size="sm" label={band.label} />
        </div>
        <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1 leading-relaxed">{gap.benchmark}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="t-caption-sm text-accent-info">{gap.demandLabel}</div>
        <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
          {gap.competitorDomain} · #{gap.competitorPosition}
        </div>
      </div>
    </div>
  );
}

export function CompetitorGapsSection({ workspaceId, tier }: CompetitorGapsSectionProps) {
  const isPremium = tier === 'premium';
  // Only Premium hits the endpoint — the server 402s every other tier, so a
  // non-Premium fetch would be a guaranteed failure. Growth/free render the
  // soft-gate teaser below instead.
  const { data, isLoading, isError, refetch } = useClientCompetitorGaps(workspaceId, isPremium);

  // ── Soft-gate for Growth / free (no live data fetched) ──────────────────
  if (!isPremium) {
    return (
      <SectionCard
        title="Competitor keyword gaps"
        titleIcon={<Users className="w-4 h-4 text-[var(--brand-text-muted)]" />}
      >
        <TierGate
          tier={tier}
          required="premium"
          feature="Competitor keyword gaps"
          teaser="See the exact keywords your competitors rank for that you're missing — and who's winning them. Available on Premium."
        >
          {/* Audit blocker #6: NO fabricated/blurred competitor rows. Non-Premium tiers fetch
              no real competitor data, so we show one honest, generic placeholder — never invented
              "near me"/keyword teaser strings. The TierGate overlay is the upsell payoff. */}
          <div className="px-3 py-2.5 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40">
            <p className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed">
              Your strategist is mapping your competitive landscape.
            </p>
          </div>
        </TierGate>
      </SectionCard>
    );
  }

  if (isLoading) {
    return (
      <SectionCard title="Competitor keyword gaps" titleIcon={<Users className="w-4 h-4 text-[var(--brand-text-muted)]" />}>
        <LoadingState message="Comparing your rankings against competitors..." />
      </SectionCard>
    );
  }

  if (isError) {
    return (
      <SectionCard title="Competitor keyword gaps" titleIcon={<Users className="w-4 h-4 text-[var(--brand-text-muted)]" />}>
        <ErrorState
          message="We couldn't load your competitor gaps just now."
          action={{ label: 'Retry', onClick: () => { void refetch(); } }}
        />
      </SectionCard>
    );
  }

  const gaps = data?.gaps ?? [];

  if (gaps.length === 0) {
    return (
      <SectionCard title="Competitor keyword gaps" titleIcon={<Users className="w-4 h-4 text-[var(--brand-text-muted)]" />}>
        <EmptyState
          icon={Target}
          title="No competitor gaps found yet"
          description="As your team analyzes competitors, keywords they rank for that you're missing will appear here — each one a chance to win ground."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Competitor keyword gaps"
      titleIcon={<Users className="w-4 h-4 text-[var(--brand-text-muted)]" />}
      titleExtra={
        <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]">
          {data?.total ?? gaps.length}
        </span>
      }
      action={
        <span className="inline-flex items-center gap-1 t-caption-sm text-accent-brand">
          <Lock className="w-3 h-3" /> Premium
        </span>
      }
    >
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3 leading-relaxed">
        Keywords your competitors rank for that you don't yet. Highest-opportunity wins are listed first.
      </p>
      <div className="space-y-1.5">
        {gaps.map((gap, i) => <GapRow key={`${gap.keyword}-${i}`} gap={gap} />)}
      </div>
    </SectionCard>
  );
}
