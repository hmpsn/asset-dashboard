// @ds-rebuilt
import type { CockpitKpiModel } from '../../hooks/admin/useCockpitRebuilt';
import { CompactStatBar, scoreColorClass } from '../ui';
import { formatCompactNumber, formatMoney, formatPercent } from './cockpitFormatters';

interface CockpitDecisionBandProps {
  kpis: Pick<CockpitKpiModel, 'trafficValue' | 'contentVelocity' | 'overallHealth'>;
}

export function CockpitDecisionBand({ kpis }: CockpitDecisionBandProps) {
  const organicValue = kpis.trafficValue.organic;
  const velocityAverage = kpis.contentVelocity.trailingThreeMonthAvg;
  const currentMonthPublished = kpis.contentVelocity.currentMonthPublished;
  const velocityTrend = kpis.contentVelocity.trendPct;
  const healthScore = kpis.overallHealth.score;
  const velocityTrendText = typeof velocityTrend === 'number' && Number.isFinite(velocityTrend)
    ? `${velocityTrend >= 0 ? '+' : ''}${formatPercent(velocityTrend, { alreadyPercent: true })} trend`
    : null;
  const velocitySub = velocityAverage == null
    ? 'Establishing'
    : [
        currentMonthPublished == null ? null : `${formatCompactNumber(currentMonthPublished)} this month`,
        velocityTrendText,
      ].filter((detail): detail is string => detail != null).join(' · ') || undefined;

  return (
    <section aria-label="Cockpit decision metrics" className="mb-4">
      <CompactStatBar
        items={[
          {
            label: 'Organic value',
            value: formatMoney(organicValue),
            valueColor: organicValue == null ? 'text-[var(--brand-text-dim)]' : 'text-[var(--blue)]',
            sub: organicValue == null ? 'Unavailable' : undefined,
          },
          {
            label: 'Content velocity',
            value: velocityAverage == null ? '—' : `${formatCompactNumber(velocityAverage)}/mo`,
            valueColor: velocityAverage == null ? 'text-[var(--brand-text-dim)]' : 'text-[var(--blue)]',
            sub: velocitySub,
          },
          {
            label: 'Overall health',
            value: healthScore ?? '—',
            valueColor: healthScore == null ? 'text-[var(--brand-text-dim)]' : scoreColorClass(healthScore),
            sub: kpis.overallHealth.label,
          },
        ]}
      />
    </section>
  );
}
