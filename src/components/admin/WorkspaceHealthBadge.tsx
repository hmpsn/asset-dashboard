import { MetricRingSvg } from '../ui/MetricRing';
import { scoreColorClass } from '../ui/constants';

interface WorkspaceHealthBadgeProps {
  score: number | null | undefined;
  size?: number;
}

export function WorkspaceHealthBadge({ score, size = 36 }: WorkspaceHealthBadgeProps) {
  if (score == null) return null;

  return (
    <div className="flex items-center gap-1.5">
      <MetricRingSvg score={score} size={size} />
      <span className={`text-sm font-semibold ${scoreColorClass(score)}`}>
        {score}
      </span>
    </div>
  );
}
