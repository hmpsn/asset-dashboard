import { useNavigate } from 'react-router-dom';
import { Button } from '../ui';
import { MetricRing } from '../ui/MetricRing';
import { SectionCard } from '../ui/SectionCard';
import { scoreColorClass } from '../ui/constants';
import { clientPath } from '../../routes';
import { useBetaMode } from './BetaContext';

interface HealthScoreCardProps {
  score: number | null | undefined;
  workspaceId: string;
}

export function HealthScoreCard({ score, workspaceId }: HealthScoreCardProps) {
  const navigate = useNavigate();
  const betaMode = useBetaMode();
  if (score == null) return null;
  const rounded = Math.round(score);

  const label =
    rounded >= 80
      ? 'Your site is performing well across key SEO signals.'
      : rounded >= 60
        ? 'Your site has room for improvement in some areas.'
        : 'Your site needs attention to improve search performance.';

  return (
    <SectionCard title="SEO Health Score">
      <div className="flex items-center gap-6">
        <MetricRing score={rounded} size={100} />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className={`t-h1 ${scoreColorClass(rounded)}`}>
              {rounded}
            </span>
            <span className="t-body text-[var(--brand-text-muted)]">/ 100</span>
          </div>
          <p className="t-body text-[var(--brand-text)] leading-relaxed">{label}</p>
          <div className="flex flex-wrap gap-3 t-caption-sm text-[var(--brand-text-muted)]">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-[var(--radius-pill)] bg-emerald-400" />
              80+ Healthy
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-[var(--radius-pill)] bg-amber-400" />
              60-79 Needs work
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-[var(--radius-pill)] bg-red-400" />
              Below 60 Critical
            </span>
          </div>
          {rounded < 80 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => navigate(`${clientPath(workspaceId, 'health', betaMode)}?severity=error`)}
              >
                View Priority Issues
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate(`${clientPath(workspaceId, 'inbox', betaMode)}?tab=conversations`)}
              >
                Request SEO Help
              </Button>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
