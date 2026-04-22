import { Fragment, useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Circle, Clock, ArrowUpDown } from 'lucide-react';
import { Badge } from './ui/index.js';
import type { SprintData } from '../../shared/types/roadmap.js';
import type { RoadmapFilters, SortKey, SortDir, FlatRoadmapItem } from '../lib/roadmapFilters.js';
import { matchesFilters, sortItems } from '../lib/roadmapFilters.js';

const PRIORITY_BADGE: Record<string, { label: string; color: 'red' | 'orange' | 'amber' | 'green' | 'zinc' }> = {
  P0: { label: 'P0', color: 'red' },
  P1: { label: 'P1', color: 'orange' },
  P2: { label: 'P2', color: 'amber' },
  P3: { label: 'P3', color: 'green' },
  P4: { label: 'P4', color: 'zinc' },
};

const STATUS_ICON = {
  done: <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />,
  in_progress: <Clock className="w-3.5 h-3.5 text-teal-400 animate-pulse" />,
  pending: <Circle className="w-3.5 h-3.5 text-zinc-600" />,
};

interface Props {
  sprints: SprintData[];
  filters: RoadmapFilters;
  featureMap: Map<number, string>;
  onToggleStatus: (itemId: number) => void;
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

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 text-zinc-600" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-teal-400" />
      : <ChevronDown className="w-3 h-3 text-teal-400" />;
  }

  const th = 'px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-300 select-none';
  const thStatic = 'px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider';

  if (sorted.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500 text-sm">
        No items match the current filters.
      </div>
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
              <span className="flex items-center gap-1">Priority <SortIcon col="priority" /></span>
            </th>
            <th className={th} onClick={() => handleSort('status')}>
              <span className="flex items-center gap-1">Status <SortIcon col="status" /></span>
            </th>
            <th className={thStatic}>Sprint</th>
            <th className={thStatic}>Feature</th>
            <th className={thStatic}>Tags</th>
            <th className={th} onClick={() => handleSort('est')}>
              <span className="flex items-center gap-1">Est <SortIcon col="est" /></span>
            </th>
            <th className={th} onClick={() => handleSort('createdAt')}>
              <span className="flex items-center gap-1">Added <SortIcon col="createdAt" /></span>
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
                    {featureName && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20 whitespace-nowrap">
                        {featureName}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      {item.tags?.map(tag => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 whitespace-nowrap"
                        >
                          {tag}
                        </span>
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
