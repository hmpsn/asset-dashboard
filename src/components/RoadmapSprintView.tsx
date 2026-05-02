import { CheckCircle2, FilterX } from 'lucide-react';
import { Badge, EmptyState, SectionCard } from './ui/index';
import type { SprintData } from '../../shared/types/roadmap';
import type { RoadmapFilters } from '../lib/roadmapFilters';
import { matchesFilters } from '../lib/roadmapFilters';
import { priorityBadge, STATUS_ICON, FeatureChip, TagChip } from '../lib/roadmapConstants';

interface Props {
  sprints: SprintData[];
  filters: RoadmapFilters;
  featureMap: Map<number, string>;
  onToggleStatus: (itemId: number | string, sprintId: string) => void;
}

export function RoadmapSprintView({ sprints, filters, featureMap, onToggleStatus }: Props) {
  const visibleSprints = sprints.filter(sprint =>
    sprint.items.some(item => matchesFilters(item, filters, sprint.id)),
  );

  if (visibleSprints.length === 0) {
    return (
      <EmptyState
        icon={FilterX}
        title="No items match the current filters"
        description="Try clearing one or more filters to see more roadmap items."
      />
    );
  }

  return (
    <div className="space-y-8">
      {visibleSprints.map(sprint => {
        const filteredItems = sprint.items.filter(item =>
          matchesFilters(item, filters, sprint.id),
        );
        const done = sprint.items.filter(i => i.status === 'done').length;
        const total = sprint.items.length;

        return (
          <div key={sprint.id}>
            {/* Sprint section header */}
            <div className="flex items-center gap-3 pb-2 border-b border-[var(--brand-border)]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--brand-text-bright)] uppercase tracking-wide">
                    {sprint.name}
                  </span>
                  <span className="t-caption text-[var(--brand-text-muted)]">{done}/{total} done</span>
                  {done === total && total > 0 && (
                    <CheckCircle2 className="w-3 h-3 text-accent-success" />
                  )}
                </div>
                {sprint.rationale && (
                  <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 truncate">{sprint.rationale}</p>
                )}
              </div>
              {sprint.hours && (
                <span className="t-caption text-[var(--brand-text-muted)] flex-shrink-0">{sprint.hours} hrs</span>
              )}
            </div>

            {/* Item list. The divide-y must wrap the rows directly — putting it on
                SectionCard's outer div is a no-op because SectionCard wraps all
                children in a single inner padding div, leaving no siblings to divide. */}
            <SectionCard variant="subtle" noPadding className="mt-2">
              <div className="divide-y divide-[var(--brand-border)]">
              {filteredItems.map(item => {
                const pb = priorityBadge(item.priority);
                const featureName = item.featureId != null ? featureMap.get(item.featureId) : undefined;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-3)] transition-colors"
                  >
                    <span className="t-caption-sm font-mono text-[var(--brand-text-muted)] w-10 flex-shrink-0 text-right">
                      #{item.id}
                    </span>
                    <button
                      onClick={() => onToggleStatus(item.id, sprint.id)}
                      className="flex-shrink-0 hover:scale-110 transition-transform"
                      title={`Status: ${item.status} — click to cycle`}
                    >
                      {STATUS_ICON[item.status]}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs font-medium ${
                            item.status === 'done' ? 'text-[var(--brand-text-muted)] line-through' : 'text-[var(--brand-text-bright)]'
                          }`}
                        >
                          {item.title}
                        </span>
                        <Badge label={pb.label} color={pb.color} />
                        {featureName && <FeatureChip>{featureName}</FeatureChip>}
                        {item.tags?.map(tag => (
                          <TagChip key={tag}>{tag}</TagChip>
                        ))}
                      </div>
                    </div>
                    <div className="flex-shrink-0 t-caption text-[var(--brand-text-muted)]">{item.est}</div>
                  </div>
                );
              })}
              </div>
            </SectionCard>
          </div>
        );
      })}
    </div>
  );
}
