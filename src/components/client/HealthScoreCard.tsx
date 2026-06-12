import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Button, Icon } from '../ui';
import { MetricRing } from '../ui/MetricRing';
import { SectionCard } from '../ui/SectionCard';
import { scoreColor, scoreColorClass } from '../ui/constants';
import { clientPath } from '../../routes';
import { useBetaMode } from './BetaContext';
import type { ClientCompositeHealthBreakdown } from '../../../shared/types/intelligence.js';

interface HealthScoreCardProps {
  score: number | null | undefined;
  workspaceId: string;
  breakdown?: ClientCompositeHealthBreakdown | null;
}

export function HealthScoreCard({ score, workspaceId, breakdown }: HealthScoreCardProps) {
  const navigate = useNavigate();
  const betaMode = useBetaMode();
  if (score == null) return null;
  const rounded = Math.round(score);
  const breakdownRows = breakdown?.rows ?? [];

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
      {breakdownRows.length > 0 && (
        <details className="group mt-5 border-t border-[var(--brand-border)] pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-left text-accent-brand">
            <span className="t-ui font-medium">What makes up this score</span>
            <Icon
              as={ChevronDown}
              size="sm"
              className="shrink-0 transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {breakdownRows.map((row) => {
              const rowScore = Math.round(row.score);
              return (
                <div
                  key={row.id}
                  className="border border-[var(--brand-border)] bg-[var(--surface-2)] p-3"
                  style={{ borderRadius: 'var(--radius-md)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="t-label text-[var(--brand-text)]">{row.label}</div>
                      <div className="t-caption-sm text-accent-info">{row.weight}% weight</div>
                    </div>
                    <div className={`t-body font-semibold ${scoreColorClass(rowScore)}`}>{rowScore}</div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-3)]">
                    <div
                      className="h-full rounded-[var(--radius-pill)]"
                      style={{ width: `${Math.max(0, Math.min(100, rowScore))}%`, backgroundColor: scoreColor(rowScore) }}
                    />
                  </div>
                  <p className="mt-2 t-caption text-[var(--brand-text-muted)] leading-relaxed">
                    {row.description}
                  </p>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </SectionCard>
  );
}
