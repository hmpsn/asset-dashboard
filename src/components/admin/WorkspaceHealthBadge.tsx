import { MetricRingSvg } from '../ui/MetricRing';
import { scoreColorClass } from '../ui/constants';

interface WorkspaceHealthBadgeProps {
  score: number | null | undefined;
  size?: number;
}

export function WorkspaceHealthBadge({ score, size = 36 }: WorkspaceHealthBadgeProps) {
  if (score == null) return null;
  const rounded = Math.round(score);

  return (
    <div className="flex items-center gap-1.5">
      <MetricRingSvg score={rounded} size={size} />
      <span className={`text-sm font-semibold ${scoreColorClass(rounded)}`}>
        {rounded}
      </span>
    </div>
  );
}
