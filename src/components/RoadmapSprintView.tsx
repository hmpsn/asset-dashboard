import { CheckCircle2, FilterX } from 'lucide-react';
import { Badge, EmptyState } from './ui/index';
import type { SprintData } from '../../shared/types/roadmap';
import type { RoadmapFilters } from '../lib/roadmapFilters';
import { matchesFilters } from '../lib/roadmapFilters';
import { priorityBadge, STATUS_ICON, FeatureChip, TagChip } from '../lib/roadmapConstants';

interface Props {
  sprints: SprintData[];
  filters: RoadmapFilters;
  featureMap: Map<number, string>;
  onToggleStatus: (itemId: number | string) => void;
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
            <div className="flex items-center gap-3 pb-2 border-b border-zinc-700/60">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">
                    {sprint.name}
                  </span>
                  <span className="text-[11px] text-zinc-500">{done}/{total} done</span>
                  {done === total && total > 0 && (
                    <CheckCircle2 className="w-3 h-3 text-green-400" />
                  )}
                </div>
                {sprint.rationale && (
                  <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{sprint.rationale}</p>
                )}
              </div>
              {sprint.hours && (
                <span className="text-[11px] text-zinc-600 flex-shrink-0">{sprint.hours} hrs</span>
              )}
            </div>

            {/* Item list */}
            <div className="mt-2 bg-zinc-900/40 border border-zinc-800 rounded-lg divide-y divide-zinc-800/50">
              {filteredItems.map(item => {
                const pb = priorityBadge(item.priority);
                const featureName = item.featureId != null ? featureMap.get(item.featureId) : undefined;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/30 transition-colors"
                  >
                    <span className="text-[10px] text-zinc-600 font-mono w-10 flex-shrink-0 text-right">
                      #{item.id}
                    </span>
                    <button
                      onClick={() => onToggleStatus(item.id)}
                      className="flex-shrink-0 hover:scale-110 transition-transform"
                      title={`Status: ${item.status} — click to cycle`}
                    >
                      {STATUS_ICON[item.status]}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs font-medium ${
                            item.status === 'done' ? 'text-zinc-500 line-through' : 'text-zinc-200'
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
                    <div className="flex-shrink-0 text-[11px] text-zinc-500">{item.est}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
