import { Fragment, useState } from 'react';
import { ChevronDown, ChevronUp, ArrowUpDown, FilterX } from 'lucide-react';
import { Badge, EmptyState } from './ui/index';
import type { SprintData } from '../../shared/types/roadmap';
import type { RoadmapFilters, SortKey, SortDir, FlatRoadmapItem } from '../lib/roadmapFilters';
import { matchesFilters, sortItems } from '../lib/roadmapFilters';
import { PRIORITY_BADGE, STATUS_ICON, FeatureChip, TagChip } from '../lib/roadmapConstants';

interface Props {
  sprints: SprintData[];
  filters: RoadmapFilters;
  featureMap: Map<number, string>;
  onToggleStatus: (itemId: number) => void;
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 text-zinc-600" />;
  return sortDir === 'asc'
    ? <ChevronUp className="w-3 h-3 text-teal-400" />
    : <ChevronDown className="w-3 h-3 text-teal-400" />;
}

export function RoadmapBacklogView({ sprints, filters, featureMap, onToggleStatus }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('priority');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const flatItems: FlatRoadmapItem[] = sprints.flatMap(sprint =>
    sprint.items
      .filter(item => matchesFilters(item, filters, sprint.id))
      .map(item => ({ ...item, sprintId: sprint.id, sprintName: sprint.name })),
  );

  const sorted = sortItems(flatItems, sortKey, sortDir);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const th = 'px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-300 select-none';
  const thStatic = 'px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider';

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={FilterX}
        title="No items match the current filters"
        description="Try clearing one or more filters to see more roadmap items."
      />
    );
  }

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead className="border-b border-zinc-800">
          <tr>
            <th className={thStatic} style={{ width: '52px' }}>#</th>
            <th className={thStatic} style={{ minWidth: '220px' }}>Title</th>
            <th className={th} onClick={() => handleSort('priority')}>
              <span className="flex items-center gap-1">Priority <SortIcon col="priority" sortKey={sortKey} sortDir={sortDir} /></span>
            </th>
            <th className={th} onClick={() => handleSort('status')}>
              <span className="flex items-center gap-1">Status <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} /></span>
            </th>
            <th className={thStatic}>Sprint</th>
            <th className={thStatic}>Feature</th>
            <th className={thStatic}>Tags</th>
            <th className={th} onClick={() => handleSort('est')}>
              <span className="flex items-center gap-1">Est <SortIcon col="est" sortKey={sortKey} sortDir={sortDir} /></span>
            </th>
            <th className={th} onClick={() => handleSort('createdAt')}>
              <span className="flex items-center gap-1">Added <SortIcon col="createdAt" sortKey={sortKey} sortDir={sortDir} /></span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {sorted.map(item => {
            const pb = PRIORITY_BADGE[item.priority];
            const featureName = item.featureId != null ? featureMap.get(item.featureId) : undefined;
            const isExpanded = expandedId === item.id;

            return (
              <Fragment key={item.id}>
                <tr
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="hover:bg-zinc-800/30 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2.5 font-mono text-[10px] text-zinc-600">#{item.id}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={e => { e.stopPropagation(); onToggleStatus(item.id); }}
                        className="hover:scale-110 transition-transform flex-shrink-0"
                        title={`Status: ${item.status} — click to cycle`}
                      >
                        {STATUS_ICON[item.status]}
                      </button>
                      <span className={item.status === 'done' ? 'text-zinc-500 line-through' : 'text-zinc-200'}>
                        {item.title}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge label={pb.label} color={pb.color} />
                  </td>
                  <td className="px-3 py-2.5 text-zinc-400 capitalize">
                    {item.status.replace('_', ' ')}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-500 text-[11px] max-w-[120px] truncate">
                    {item.sprintName}
                  </td>
                  <td className="px-3 py-2.5">
                    {featureName && <FeatureChip nowrap>{featureName}</FeatureChip>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      {item.tags?.map(tag => (
                        <TagChip key={tag} nowrap>{tag}</TagChip>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-zinc-500 whitespace-nowrap">{item.est}</td>
                  <td className="px-3 py-2.5 text-zinc-500 font-mono text-[10px] whitespace-nowrap">
                    {item.createdAt ?? '—'}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-zinc-800/20">
                    <td colSpan={9} className="px-4 py-3">
                      <div className="space-y-1.5">
                        {item.notes && (
                          <p className="text-[11px] text-zinc-300 leading-relaxed">{item.notes}</p>
                        )}
                        <div className="flex items-center gap-4 text-[10px] text-zinc-500">
                          <span>Source: {item.source}</span>
                          {item.shippedAt && <span>Shipped: {item.shippedAt}</span>}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
