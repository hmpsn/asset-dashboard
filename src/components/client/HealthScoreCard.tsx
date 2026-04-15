import { MetricRing } from '../ui/MetricRing';
import { SectionCard } from '../ui/SectionCard';
import { scoreColorClass } from '../ui/constants';

interface HealthScoreCardProps {
  score: number | null | undefined;
}

export function HealthScoreCard({ score }: HealthScoreCardProps) {
  if (score == null) return null;

  const label =
    score >= 80
      ? 'Your site is performing well across key SEO signals.'
      : score >= 60
        ? 'Your site has room for improvement in some areas.'
        : 'Your site needs attention to improve search performance.';

  return (
    <SectionCard title="SEO Health Score">
      <div className="flex items-center gap-6">
        <MetricRing score={score} size={100} />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-bold ${scoreColorClass(score)}`}>
              {score}
            </span>
            <span className="text-sm text-zinc-500">/ 100</span>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">{label}</p>
          <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              80+ Healthy
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              60-79 Needs work
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              Below 60 Critical
            </span>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
