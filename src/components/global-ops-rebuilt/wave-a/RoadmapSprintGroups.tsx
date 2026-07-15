// @ds-rebuilt
import { EmptyState, Icon, Skeleton } from '../../ui';
import { RoadmapItemRow } from './RoadmapItemRow';
import { formatSprintHours } from './roadmapModel';
import type { RoadmapDisplayGroup, RoadmapDisplayRow } from './roadmapDisplayTypes';

interface RoadmapSprintGroupsProps {
  groups: RoadmapDisplayGroup[];
  expandedKey: string | null;
  cyclingKey: string | null;
  loading: boolean;
  onToggle: (key: string) => void;
  onCycle: (row: RoadmapDisplayRow) => void;
}

export function RoadmapSprintGroups({ groups, expandedKey, cyclingKey, loading, onToggle, onCycle }: RoadmapSprintGroupsProps) {
  if (loading) return <Skeleton className="h-[260px] w-full" />;
  if (groups.length === 0) return <EmptyState icon={({ className }) => <Icon name="search" className={className} />} title="No roadmap items match" description="Clear a filter to inspect more work." />;

  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const hours = formatSprintHours(group.hours);
        return (
        <section key={group.id} aria-labelledby={`${group.id}-heading`}>
          <div className="mb-2 flex items-end gap-3 border-b border-[var(--brand-border)] pb-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 id={`${group.id}-heading`} className="t-label uppercase tracking-[0.04em] text-[var(--brand-text-bright)]">{group.name}</h2>
                <span className="t-caption-sm text-[var(--brand-text-muted)]">{group.done}/{group.total} done</span>
              </div>
              {/* muted-tier-ok: sprint rationale is tertiary context beneath the group title. */}
              {group.rationale && <p className="mt-0.5 truncate t-caption-sm text-[var(--brand-text-dim)]">{group.rationale}</p>}
            </div>
            {hours && <span className="ml-auto shrink-0 t-mono text-[var(--brand-text-dim)]">{hours}</span>}
          </div>
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]">
            {group.rows.map((row) => <RoadmapItemRow key={row.rowKey} row={row} expanded={expandedKey === row.rowKey} cycling={cyclingKey === row.rowKey} onToggle={() => onToggle(row.rowKey)} onCycle={() => onCycle(row)} />)}
          </div>
        </section>
        );
      })}
    </div>
  );
}
