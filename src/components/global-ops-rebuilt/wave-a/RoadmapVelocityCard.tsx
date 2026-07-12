// @ds-rebuilt
import { SectionCard, Skeleton } from '../../ui';
import { formatNumber } from '../globalOpsFormatters';
import type { VelocityPoint } from './roadmapDisplayTypes';

interface RoadmapVelocityCardProps {
  points: VelocityPoint[];
  loading: boolean;
}

export function RoadmapVelocityCard({ points, loading }: RoadmapVelocityCardProps) {
  const maximum = Math.max(1, ...points.map((point) => point.count));
  const shipped = points.reduce((sum, point) => sum + point.count, 0);

  return (
    <SectionCard noPadding>
      <div className="px-[18px] pb-3 pt-3.5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="t-caption font-semibold text-[var(--brand-text-bright)]">Shipping velocity</h2>
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {loading ? 'Calculating shipped work…' : `${formatNumber(shipped)} items across recent sprints`}
          </span>
        </div>
        {loading ? (
          <Skeleton className="h-[88px] w-full" />
        ) : points.length === 0 ? (
          <div className="flex h-[88px] items-center justify-center t-caption text-[var(--brand-text-muted)]">
            No shipped items are dated to a sprint yet.
          </div>
        ) : (
          <div className="flex h-[88px] items-end gap-2" aria-label="Items shipped per recent sprint">
            {points.map((point) => {
              const height = Math.max(4, Math.round((point.count / maximum) * 58));
              return (
                <div key={point.id} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="t-micro font-semibold tabular-nums text-[var(--brand-text)]">{formatNumber(point.count)}</span>
                  <span
                    className="w-full rounded-t-[var(--radius-sm)] bg-[linear-gradient(180deg,var(--teal),color-mix(in_srgb,var(--teal)_68%,var(--surface-1)))]"
                    style={{ height }}
                    title={`${point.fullLabel}: ${formatNumber(point.count)} shipped`}
                  />
                  <span className="max-w-full truncate t-micro text-[var(--brand-text-dim)]" title={point.fullLabel}>{point.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
