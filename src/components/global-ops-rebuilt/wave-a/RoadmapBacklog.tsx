// @ds-rebuilt
import { EmptyState, Icon, Skeleton } from '../../ui';
import { RoadmapItemRow } from './RoadmapItemRow';
import type { RoadmapDisplayRow } from './roadmapDisplayTypes';

interface RoadmapBacklogProps {
  rows: RoadmapDisplayRow[];
  expandedKey: string | null;
  cyclingKey: string | null;
  loading: boolean;
  onToggle: (key: string) => void;
  onCycle: (row: RoadmapDisplayRow) => void;
}

export function RoadmapBacklog({ rows, expandedKey, cyclingKey, loading, onToggle, onCycle }: RoadmapBacklogProps) {
  if (loading) return <Skeleton className="h-[300px] w-full" />;
  if (rows.length === 0) return <EmptyState icon={({ className }) => <Icon name="search" className={className} />} title="No roadmap items match" description="Clear a filter to inspect more work." />;

  return (
    <section aria-label="Roadmap backlog" className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]">
      <div
        data-testid="roadmap-backlog-header"
        data-layout="six-column"
        className="grid min-w-[760px] grid-cols-[100px_28px_minmax(0,1fr)_72px_62px_96px] items-center gap-3 border-b border-[var(--brand-border)] bg-[var(--surface-1)] px-[15px] py-2 t-micro uppercase tracking-[0.05em] text-[var(--brand-text-dim)]"
      >
        <span className="text-right">ID</span><span><span className="sr-only">Change status</span></span><span>Item</span><span>Priority</span><span>Est</span><span>Status</span>
      </div>
      {rows.map((row) => <RoadmapItemRow key={row.rowKey} row={row} expanded={expandedKey === row.rowKey} cycling={cyclingKey === row.rowKey} variant="backlog" onToggle={() => onToggle(row.rowKey)} onCycle={() => onCycle(row)} />)}
    </section>
  );
}
