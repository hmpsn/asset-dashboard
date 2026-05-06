import { SectionCard } from '../../ui';

interface StrategySnapshotSectionProps {
  healthScore: number;
  generatedAt: string;
  contentGapsFound: number;
  totalPageImprovements: number;
  pagesRanking: number;
  totalPages: number;
  strategyKeywordCount: number;
  contentScore: number;
  quickWinScore: number;
  coverageScore: number;
}

export function StrategySnapshotSection({
  healthScore,
  generatedAt,
  contentGapsFound,
  totalPageImprovements,
  pagesRanking,
  totalPages,
  strategyKeywordCount,
  contentScore,
  quickWinScore,
  coverageScore,
}: StrategySnapshotSectionProps) {
  const readinessLabel = healthScore >= 80
    ? 'Strong action plan'
    : healthScore >= 60
      ? 'Good opportunity mix'
      : 'Building your strategy';
  const scoreClass = healthScore >= 80
    ? 'text-accent-success'
    : healthScore >= 60
      ? 'text-accent-warning'
      : 'text-accent-brand';

  return (
    <SectionCard>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className={`t-stat-lg ${scoreClass}`}>
            {/* score-color-deviation-ok: planning readiness, not a health grade - teal avoids false alarm */}
            {healthScore}<span className="t-caption-sm text-[var(--brand-text-muted)]">/100</span>
          </div>
          <div>
            <div className="t-label text-[var(--brand-text-muted)]">Strategy Snapshot</div>
            <div className="t-body font-medium text-[var(--brand-text)]">{readinessLabel}</div>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
              Generated {new Date(generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[560px]">
          <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/45 border border-[var(--brand-border)]/60 px-3 py-2">
            <div className="t-caption-sm text-[var(--brand-text-muted)]">Create content</div>
            <div className="t-stat-sm text-[var(--brand-text-bright)]">{contentGapsFound}</div>
          </div>
          <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/45 border border-[var(--brand-border)]/60 px-3 py-2">
            <div className="t-caption-sm text-[var(--brand-text-muted)]">Improve pages</div>
            <div className="t-stat-sm text-[var(--brand-text-bright)]">{totalPageImprovements}</div>
          </div>
          <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/45 border border-[var(--brand-border)]/60 px-3 py-2">
            <div className="t-caption-sm text-[var(--brand-text-muted)]">Ranking coverage</div>
            <div className="t-stat-sm text-[var(--brand-text-bright)]">{pagesRanking}/{totalPages}</div>
          </div>
          <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/45 border border-[var(--brand-border)]/60 px-3 py-2">
            <div className="t-caption-sm text-[var(--brand-text-muted)]">Strategy keywords</div>
            <div className="t-stat-sm text-[var(--brand-text-bright)]">{strategyKeywordCount}</div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 mt-4 pt-4 border-t border-[var(--brand-border)]/50 md:grid-cols-3">
        <div>
          <div className="flex items-center justify-between t-caption-sm text-[var(--brand-text-muted)] mb-1">
            <span>Content readiness</span>
            <span>{contentScore}/40</span>
          </div>
          <div className="h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
            <div className="h-full bg-teal-500/60 rounded-[var(--radius-pill)]" style={{ width: `${(contentScore / 40) * 100}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between t-caption-sm text-[var(--brand-text-muted)] mb-1">
            <span>Page improvements</span>
            <span>{quickWinScore}/30</span>
          </div>
          <div className="h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
            <div className="h-full bg-amber-500/60 rounded-[var(--radius-pill)]" style={{ width: `${(quickWinScore / 30) * 100}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between t-caption-sm text-[var(--brand-text-muted)] mb-1">
            <span>Ranking coverage</span>
            <span>{coverageScore}/30</span>
          </div>
          <div className="h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
            <div className="h-full bg-emerald-500/60 rounded-[var(--radius-pill)]" style={{ width: `${(coverageScore / 30) * 100}%` }} />
          </div>
        </div>
      </div>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3">
        This is a planning-readiness score, not a grade. It shows how much clear SEO work is ready to review or move into production.
      </p>
    </SectionCard>
  );
}
