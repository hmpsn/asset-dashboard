// @ds-rebuilt
import { ArrowDownRight, ArrowUpRight, BarChart3, DollarSign, FileText, Layers, Search, Shield, Target } from 'lucide-react';
import { Badge, GroupBlock, MetricTile, ProvenanceChip, Sparkline } from '../ui';
import { scoreColor } from '../ui/constants';
import type { CockpitKpiModel } from '../../hooks/admin/useCockpitRebuilt';
import { formatCompactNumber, formatDate, formatMoney, formatPercent, provenanceBasis } from './cockpitFormatters';

interface CockpitKpiStripProps {
  kpis: CockpitKpiModel;
  moneyFramePrecomputedAt?: string | null;
  onOpenRoute: (route: string) => void;
  route: {
    analytics: string;
    contentHealth: string;
    contentBriefs: string;
    contentPublished: string;
    keywords: string;
    siteAudit: string;
    strategy: string;
    outcomes: string;
  };
}

export function CockpitKpiStrip({ kpis, moneyFramePrecomputedAt, onOpenRoute, route }: CockpitKpiStripProps) {
  const basis = provenanceBasis(kpis.trafficValue.provenance);
  const healthScore = kpis.overallHealth.score;

  return (
    <div className="flex flex-col gap-3" data-testid="cockpit-kpi-strip">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile
          label="Site Health"
          value={kpis.siteHealth.score ?? '—'}
          delta={kpis.siteHealth.delta ?? undefined}
          deltaLabel="pts"
          sub={`${kpis.siteHealth.errors} errors · ${kpis.siteHealth.warnings} warnings`}
          accent={kpis.siteHealth.score == null ? 'var(--brand-text-muted)' : scoreColor(kpis.siteHealth.score)}
          icon={Shield}
          onClick={() => onOpenRoute(route.siteAudit)}
        />
        <MetricTile
          label="Search Clicks"
          value={formatCompactNumber(kpis.search.clicks)}
          sub={`${formatCompactNumber(kpis.search.impressions)} impressions · ${formatPercent(kpis.search.ctr)} CTR`}
          accent="var(--blue)"
          icon={Search}
          onClick={() => onOpenRoute(route.analytics)}
        />
        <MetricTile
          label="Traffic Value"
          value={formatMoney(kpis.trafficValue.organic)}
          sub={kpis.trafficValue.adSpendEquivalent == null ? 'No ROI data yet' : `${formatMoney(kpis.trafficValue.adSpendEquivalent)} ad equivalent`}
          accent="var(--emerald)"
          icon={DollarSign}
          onClick={() => onOpenRoute(route.outcomes)}
        />
        <MetricTile
          label="Users"
          value={formatCompactNumber(kpis.ga4.users)}
          delta={kpis.ga4.usersDelta ?? undefined}
          deltaLabel="%"
          sub={`${formatCompactNumber(kpis.ga4.sessions)} sessions · ${kpis.ga4.newUserPercentage ?? '—'}% new`}
          accent="var(--blue)"
          icon={BarChart3}
          onClick={() => onOpenRoute(route.analytics)}
        />
        <MetricTile
          label="Overall Health"
          value={healthScore ?? '—'}
          sub={kpis.overallHealth.label}
          accent={healthScore == null ? 'var(--brand-text-muted)' : scoreColor(healthScore)}
          icon={Shield}
        />
        <MetricTile
          label="Rank Changes"
          value={kpis.ranks.tracked > 0 ? `${kpis.ranks.tracked} tracked` : '—'}
          sub={`${kpis.ranks.up} up · ${kpis.ranks.down} down · ${kpis.ranks.flat} flat`}
          accent={kpis.ranks.down > kpis.ranks.up ? 'var(--red)' : kpis.ranks.up > 0 ? 'var(--emerald)' : 'var(--blue)'}
          icon={ArrowUpRight}
          onClick={() => onOpenRoute(route.keywords)}
        />
        <MetricTile
          label="Content Decay"
          value={kpis.contentDecay.total || '—'}
          sub={`${kpis.contentDecay.critical} critical · ${kpis.contentDecay.warning} warning`}
          accent={kpis.contentDecay.critical > 0 ? 'var(--red)' : 'var(--amber)'}
          icon={ArrowDownRight}
          onClick={() => onOpenRoute(route.contentHealth)}
        />
        <MetricTile
          label="Content Pipeline"
          value={kpis.contentPipeline.percent == null ? '—' : `${kpis.contentPipeline.percent}%`}
          sub={`${kpis.contentPipeline.published}/${kpis.contentPipeline.total} published`}
          accent="var(--teal)"
          icon={Layers}
          onClick={() => onOpenRoute(route.contentBriefs)}
        />
        <MetricTile
          label="Coverage Gaps"
          value={kpis.coverageGaps || '—'}
          sub="Engine hand-off"
          accent="var(--blue)"
          icon={Target}
          onClick={() => onOpenRoute(route.strategy)}
        />
        <MetricTile
          label="Content Velocity"
          value={kpis.contentVelocity.trailingThreeMonthAvg == null ? '—' : `${kpis.contentVelocity.trailingThreeMonthAvg}/mo`}
          delta={kpis.contentVelocity.trendPct ?? undefined}
          deltaLabel="%"
          sub={`${kpis.contentVelocity.currentMonthPublished ?? 0} this month`}
          accent="var(--blue)"
          icon={FileText}
          onClick={() => onOpenRoute(route.contentPublished)}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <GroupBlock
          title="Money frame"
          meta={moneyFramePrecomputedAt ? `Precomputed ${formatDate(moneyFramePrecomputedAt)}` : 'No precomputed frame yet'}
          icon={DollarSign}
          iconColor="var(--emerald)"
          stats={[
            { label: 'at stake', value: formatMoney(kpis.trafficValue.valueAtStake), color: 'var(--emerald)' },
            { label: 'recovered', value: formatMoney(kpis.trafficValue.recoveredSoFar), color: 'var(--blue)' },
          ]}
        >
          <div className="flex flex-wrap items-center gap-2 px-2 py-1">
            {basis ? <ProvenanceChip basis={basis} /> : <Badge label="not precomputed" tone="zinc" variant="soft" size="sm" />}
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              Stored admin money frame only; no render-time ROI computation.
            </span>
          </div>
        </GroupBlock>

        <GroupBlock
          title="Content pace trend"
          meta={kpis.contentVelocity.monthly.length > 1 ? `${kpis.contentVelocity.monthly.length} real monthly points` : 'Not enough snapshots yet'}
          icon={FileText}
          iconColor="var(--blue)"
        >
          <div className="flex items-center gap-3 px-2 py-1">
            <Sparkline
              data={kpis.contentVelocity.monthly}
              area
              label="Published content by month"
            />
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              {kpis.contentVelocity.monthly.length > 0 ? 'Published posts only.' : 'No velocity series yet.'}
            </span>
          </div>
        </GroupBlock>
      </div>
    </div>
  );
}
