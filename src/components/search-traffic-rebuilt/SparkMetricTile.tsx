// @ds-rebuilt
import type { LucideIcon } from 'lucide-react';
import { MetricTile, Sparkline } from '../ui';
import { cn } from '../../lib/utils';

interface SparkMetricTileProps {
  label: string;
  value: string | number;
  sparkline: number[];
  sparklineLabel: string;
  delta?: number;
  deltaLabel?: string;
  accent?: string;
  invertDelta?: boolean;
  icon?: LucideIcon;
  onClick?: () => void;
  className?: string;
}

export function SparkMetricTile({
  label,
  value,
  sparkline,
  sparklineLabel,
  delta,
  deltaLabel,
  accent,
  invertDelta,
  icon,
  onClick,
  className,
}: SparkMetricTileProps) {
  const hasTrend = sparkline.length > 1;

  return (
    <div className="relative min-w-[130px]">
      <MetricTile
        label={label}
        value={value}
        delta={delta}
        deltaLabel={deltaLabel}
        accent={accent}
        invertDelta={invertDelta}
        icon={icon}
        onClick={onClick}
        className={cn(hasTrend ? 'pr-[94px]' : undefined, className)}
        sub={hasTrend ? `${sparkline.length} daily points` : 'No daily trend'}
      />
      {hasTrend && (
        <Sparkline
          data={sparkline}
          width={70}
          height={24}
          color={accent}
          area
          label={sparklineLabel}
          className="pointer-events-none absolute bottom-3 right-3 opacity-90"
        />
      )}
    </div>
  );
}
