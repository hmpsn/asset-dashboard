// src/components/admin/outcomes/OutcomeCoverageFunnel.tsx
// Reconcile R9 (Task B15) — ADMIN-ONLY outcome coverage funnel: tracked → measured →
// reconciled. Never render this component (or import its data hook) from src/components/client/.

import { Activity, Gauge, Target, BarChart2 } from 'lucide-react';
import { SectionCard, StatCard, EmptyState, Skeleton, Button } from '../../ui';
import { CHART_SERIES_COLORS } from '../../ui/constants';
import { useOutcomeCoverage } from '../../../hooks/admin/useOutcomes';

interface Props {
  workspaceId: string;
}

interface FunnelStage {
  key: 'tracked' | 'measured' | 'reconciled';
  label: string;
  description: string;
  value: number;
  /** Percentage of the `tracked` base this stage represents (0-100). */
  pct: number;
}

export default function OutcomeCoverageFunnel({ workspaceId }: Props) {
  const { data: coverage, isLoading, error, refetch } = useOutcomeCoverage(workspaceId);

  if (isLoading) {
    return (
      <SectionCard title="Outcome Coverage" titleIcon={<Gauge className="w-4 h-4 text-accent-info" />}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </SectionCard>
    );
  }

  if (error) {
    return (
      <SectionCard title="Outcome Coverage" titleIcon={<Gauge className="w-4 h-4 text-accent-info" />}>
        <EmptyState
          icon={BarChart2}
          title="Could not load coverage"
          description="There was a problem loading the outcome coverage funnel. Try refreshing."
          action={
            <Button
              onClick={() => refetch()}
              variant="ghost"
              size="sm"
              className="t-caption-sm px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-500/10 text-accent-brand hover:bg-teal-500/20"
            >
              Retry
            </Button>
          }
        />
      </SectionCard>
    );
  }

  if (!coverage || coverage.tracked === 0) {
    return (
      <SectionCard title="Outcome Coverage" titleIcon={<Gauge className="w-4 h-4 text-accent-info" />}>
        <EmptyState
          icon={Target}
          title="No outcomes tracked yet"
          description="Once outcomes are recorded and scored, this funnel shows how many are tracked, measured, and reconciled to real value."
        />
      </SectionCard>
    );
  }

  // Honesty note (Fix 1): today the measurement-provenance writer is gated, so every outcome
  // records as `tracked` only (recordOutcome's live call sites write provenance = NULL → the
  // estimate_ga4 fallback → tracked-only). An operator seeing a permanent 100/0/0 funnel could
  // mistake it for a bug. When there are rows but none have advanced past tracked, surface a
  // muted "not wired yet" line so the dead reading reads as honest, not broken. It disappears the
  // instant a single measured/reconciled row appears (i.e. once the gated writer lands).
  const allTrackedOnly = coverage.tracked > 0 && coverage.measured === 0 && coverage.reconciled === 0;

  const stages: FunnelStage[] = [
    {
      key: 'tracked',
      label: 'Tracked',
      description: 'Outcome rows recorded',
      value: coverage.tracked,
      pct: 100,
    },
    {
      key: 'measured',
      label: 'Measured',
      description: 'Value from a real measured action',
      value: coverage.measured,
      pct: coverage.tracked > 0 ? Math.round((coverage.measured / coverage.tracked) * 100) : 0,
    },
    {
      key: 'reconciled',
      label: 'Reconciled',
      description: 'Reconciled to closed/actual records',
      value: coverage.reconciled,
      pct: coverage.tracked > 0 ? Math.round((coverage.reconciled / coverage.tracked) * 100) : 0,
    },
  ];

  return (
    <SectionCard
      title="Outcome Coverage"
      titleIcon={<Gauge className="w-4 h-4 text-accent-info" />}
    >
      <p className="t-caption-sm text-[var(--brand-text-muted)] -mt-1 mb-4">
        How far outcome values have progressed — admin diagnostic only, never shown to clients
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard
          label="Tracked"
          value={coverage.tracked}
          icon={Activity}
          iconColor={CHART_SERIES_COLORS.blue}
          valueColor="text-accent-info"
          sub="outcome rows"
          staggerIndex={0}
        />
        <StatCard
          label="Measured"
          value={coverage.measured}
          icon={Gauge}
          iconColor={CHART_SERIES_COLORS.blue}
          valueColor="text-accent-info"
          sub={`${stages[1].pct}% of tracked`}
          staggerIndex={1}
        />
        <StatCard
          label="Reconciled"
          value={coverage.reconciled}
          icon={Target}
          iconColor={CHART_SERIES_COLORS.blue}
          valueColor="text-accent-info"
          sub={`${stages[2].pct}% of tracked`}
          staggerIndex={2}
        />
      </div>

      {/* Funnel bars — each stage width is a % of the tracked base */}
      <div className="space-y-3">
        {stages.map((stage) => (
          <div key={stage.key} className="flex items-center gap-3">
            <div className="w-24 shrink-0">
              <p className="t-caption-sm text-[var(--brand-text)]">{stage.label}</p>
              <p className="t-caption-sm text-[var(--brand-text-muted)]">{stage.description}</p>
            </div>
            <div className="flex-1 h-2 bg-[var(--surface-1)] rounded-[var(--radius-pill)] overflow-hidden">
              <div
                className="h-full rounded-[var(--radius-pill)] bg-blue-500 transition-all duration-700"
                style={{ width: `${stage.pct}%` }}
              />
            </div>
            <span className="t-caption-sm font-semibold text-accent-info w-10 text-right shrink-0">
              {stage.value}
            </span>
          </div>
        ))}
      </div>

      {allTrackedOnly && (
        <p
          data-testid="coverage-tracked-only-note"
          className="t-caption-sm text-[var(--brand-text-muted)] mt-4 pt-3 border-t border-[var(--brand-border)]"
        >
          Outcomes currently record as <span className="text-[var(--brand-text)]">tracked</span> only —
          measured/reconciled staging is not yet populated (the measurement-provenance writer is gated).
        </p>
      )}
    </SectionCard>
  );
}
