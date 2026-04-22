import { CheckCircle2, Circle, Clock } from 'lucide-react';
import { Badge } from './ui/index.js';
import type { SprintData } from '../../shared/types/roadmap.js';
import type { RoadmapFilters } from '../lib/roadmapFilters.js';
import { matchesFilters } from '../lib/roadmapFilters.js';

const PRIORITY_BADGE: Record<string, { label: string; color: 'red' | 'orange' | 'amber' | 'green' | 'zinc' }> = {
  P0: { label: 'P0', color: 'red' },
  P1: { label: 'P1', color: 'orange' },
  P2: { label: 'P2', color: 'amber' },
  P3: { label: 'P3', color: 'green' },
  P4: { label: 'P4', color: 'zinc' },
};

const STATUS_ICON = {
  done: <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />,
  in_progress: <Clock className="w-3.5 h-3.5 text-teal-400 animate-pulse flex-shrink-0" />,
  pending: <Circle className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />,
};

interface Props {
  sprints: SprintData[];
  filters: RoadmapFilters;
  featureMap: Map<number, string>;
  onToggleStatus: (itemId: number) => void;
}

export function RoadmapSprintView({ sprints, filters, featureMap, onToggleStatus }: Props) {
  const visibleSprints = sprints.filter(sprint =>
    sprint.items.some(item => matchesFilters(item, filters, sprint.id)),
  );

  if (visibleSprints.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500 text-sm">
        No items match the current filters.
      </div>
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
              <span className="text-[11px] text-zinc-600 flex-shrink-0">{sprint.hours} hrs</span>
            </div>

            {/* Item list */}
            <div className="mt-2 bg-zinc-900/40 border border-zinc-800 rounded-lg divide-y divide-zinc-800/50">
              {filteredItems.map(item => {
                const pb = PRIORITY_BADGE[item.priority];
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
                        {featureName && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                            {featureName}
                          </span>
                        )}
                        {item.tags?.map(tag => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700"
                          >
                            {tag}
                          </span>
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
