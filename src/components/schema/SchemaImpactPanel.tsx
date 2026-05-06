import { useEffect, useState } from 'react';
import { BarChart3, Clock } from 'lucide-react';
import { schemaImpact as schemaImpactApi, type SchemaDeploymentImpact, type SchemaImpactData } from '../../api/seo';
import { Icon, cn, TrendBadge } from '../ui';

export function useSchemaImpactData(workspaceId?: string) {
  const [impactData, setImpactData] = useState<SchemaImpactData | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    schemaImpactApi.get(workspaceId)
      .then(data => {
        if (!cancelled) setImpactData(data);
      })
      .catch(() => {
        // GSC not connected or no schema changes: keep the panel hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return impactData;
}

interface SchemaImpactPanelProps {
  impactData: SchemaImpactData | null;
}

export function SchemaImpactPanel({ impactData }: SchemaImpactPanelProps) {
  const [showImpactDetail, setShowImpactDetail] = useState(false);

  if (!impactData || impactData.totalDeployments === 0) {
    return null;
  }

  return (
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature)' }}>
      <button
        onClick={() => setShowImpactDetail(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon as={BarChart3} size="md" className="text-accent-brand" />
          <span className="t-caption font-medium text-[var(--brand-text-bright)]">Schema Impact</span>
          <span className="t-caption-sm text-[var(--brand-text-muted)]">{impactData.totalDeployments} deployments tracked</span>
        </div>
        <div className="flex items-center gap-3">
          {impactData.avgClicksDelta !== null && (
            <span className={cn('t-caption font-medium', impactData.avgClicksDelta >= 0 ? 'text-accent-success' : 'text-accent-danger')}>
              {impactData.avgClicksDelta >= 0 ? '+' : ''}{impactData.avgClicksDelta} clicks
            </span>
          )}
          {impactData.avgPositionDelta !== null && (
            <span className={cn('t-caption font-medium', impactData.avgPositionDelta <= 0 ? 'text-accent-success' : 'text-accent-danger')}>
              {impactData.avgPositionDelta <= 0 ? '' : '+'}{impactData.avgPositionDelta} pos
            </span>
          )}
          {impactData.tooRecent > 0 && (
            <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
              <Icon as={Clock} size="sm" /> {impactData.tooRecent} pending
            </span>
          )}
        </div>
      </button>
      {showImpactDetail && (
        <div className="border-t border-[var(--brand-border)]">
          <div className="grid grid-cols-4 gap-px bg-[var(--brand-border)]">
            {[
              { label: 'Avg Clicks', value: impactData.avgClicksDelta, suffix: '', positive: (value: number) => value >= 0 },
              { label: 'Avg Impressions', value: impactData.avgImpressionsDelta, suffix: '', positive: (value: number) => value >= 0 },
              { label: 'Avg CTR', value: impactData.avgCtrDelta, suffix: '%', positive: (value: number) => value >= 0 },
              { label: 'Avg Position', value: impactData.avgPositionDelta, suffix: '', positive: (value: number) => value <= 0 },
            ].map(stat => (
              <div key={stat.label} className="bg-[var(--surface-2)] px-3 py-2.5">
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{stat.label}</div>
                {stat.value !== null ? (
                  <div className={cn('t-body font-bold', stat.positive(stat.value) ? 'text-accent-success' : 'text-accent-danger')}>
                    {stat.value >= 0 && stat.label !== 'Avg Position' ? '+' : ''}{stat.value}{stat.suffix}
                  </div>
                ) : (
                  <div className="t-body text-[var(--brand-text-muted)]">&mdash;</div>
                )}
              </div>
            ))}
          </div>
          <div className="max-h-[240px] overflow-y-auto divide-y divide-[var(--brand-border)]/50">
            {impactData.deployments.map((deployment: SchemaDeploymentImpact) => (
              <div key={deployment.change.id} className="flex items-center gap-3 px-4 py-2">
                <div className="flex-1 min-w-0">
                  <div className="t-caption text-[var(--brand-text)] truncate">{deployment.change.pageTitle || deployment.change.pageSlug || 'Unknown page'}</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">
                    {new Date(deployment.change.changedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' '}&middot;{' '}{deployment.daysSinceChange}d ago
                  </div>
                </div>
                {deployment.tooRecent ? (
                  <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]"><Icon as={Clock} size="sm" /> Too recent</span>
                ) : deployment.before && deployment.after ? (
                  <div className="flex items-center gap-3 t-caption-sm">
                    <TrendBadge value={deployment.after.clicks - deployment.before.clicks} suffix="" showSign label="clicks" hideOnZero={false} />
                    <span className={deployment.after.position <= deployment.before.position ? 'text-accent-success' : 'text-accent-danger'}>
                      pos {deployment.after.position.toFixed(1)}
                    </span>
                  </div>
                ) : (
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">No GSC data</span>
                )}
              </div>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-[var(--brand-border)] t-caption-sm text-[var(--brand-text-muted)]">
            Compares 28-day GSC metrics before vs after each schema deployment. Changes &lt; 7 days old are marked pending.
          </div>
        </div>
      )}
    </div>
  );
}
