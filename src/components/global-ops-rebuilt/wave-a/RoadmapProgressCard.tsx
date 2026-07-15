// @ds-rebuilt
import { SectionCard } from '../../ui';

interface RoadmapProgressCardProps {
  total: number;
  done: number;
  inProgress: number;
  pending: number;
  deferred: number;
  currentSprint: string | null;
}

export function RoadmapProgressCard({ total, done, inProgress, pending, deferred, currentSprint }: RoadmapProgressCardProps) {
  const denominator = Math.max(total, 1);
  const doneWidth = (done / denominator) * 100;
  const progressWidth = (inProgress / denominator) * 100;
  const deferredWidth = (deferred / denominator) * 100;

  return (
    <SectionCard noPadding>
      <div className="px-[18px] py-3.5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="t-caption font-semibold text-[var(--brand-text)]">Overall progress</h2>
          {currentSprint && <span className="truncate t-caption-sm text-[var(--teal)]">Current: {currentSprint}</span>}
        </div>
        <div
          role="progressbar"
          aria-label="Overall roadmap completion"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="flex h-2.5 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-1)]"
        >
          <span className="h-full bg-[var(--emerald)]" style={{ width: `${doneWidth}%` }} />
          <span className="h-full bg-[var(--teal)]" style={{ width: `${progressWidth}%` }} />
          <span className="h-full bg-[var(--brand-border-hover)]" style={{ width: `${deferredWidth}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 t-caption-sm text-[var(--brand-text-muted)]">
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-[var(--radius-pill)] bg-[var(--emerald)]" />Done ({done})</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-[var(--radius-pill)] bg-[var(--teal)]" />Active ({inProgress})</span>
          {deferred > 0 && <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-[var(--radius-pill)] bg-[var(--brand-border-hover)]" />On hold ({deferred})</span>}
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-[var(--radius-pill)] bg-[var(--surface-3)]" />Pending ({pending})</span>
        </div>
      </div>
    </SectionCard>
  );
}
