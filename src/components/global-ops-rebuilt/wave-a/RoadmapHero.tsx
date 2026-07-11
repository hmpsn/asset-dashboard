// @ds-rebuilt
import { Icon } from '../../ui';
import { formatNumber } from '../globalOpsFormatters';

interface RoadmapHeroProps {
  total: number;
  done: number;
  inProgress: number;
  pending: number;
  deferred: number;
}

export function RoadmapHero({ total, done, inProgress, pending, deferred }: RoadmapHeroProps) {
  return (
    <header className="flex items-center gap-3">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[var(--radius-lg)] bg-[var(--surface-2)] text-[var(--teal)]">
        <Icon name="sitemap" size="lg" />
      </span>
      <div className="min-w-0">
        <h1 className="t-h2 text-[var(--brand-text-bright)]">Roadmap</h1>
        <p className="mt-1 t-caption text-[var(--brand-text-muted)]">
          {formatNumber(total)} items · {formatNumber(done)} done · {formatNumber(inProgress)} active · {formatNumber(pending)} pending
          {deferred > 0 ? ` · ${formatNumber(deferred)} on hold` : ''}
        </p>
      </div>
    </header>
  );
}
