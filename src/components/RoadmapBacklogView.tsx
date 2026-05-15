import { Fragment, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, ArrowUpDown, FilterX } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton, SectionCard } from './ui/index';
import type { SprintData } from '../../shared/types/roadmap';
import type { RoadmapFilters, SortKey, SortDir, FlatRoadmapItem } from '../lib/roadmapFilters';
import { matchesFilters, sortItems } from '../lib/roadmapFilters';
import { priorityBadge, STATUS_ICON, FeatureChip, TagChip } from '../lib/roadmapConstants';

interface Props {
  sprints: SprintData[];
  filters: RoadmapFilters;
  featureMap: Map<number, string>;
  onToggleStatus: (itemId: number | string, sprintId: string) => void;
}

/** Compound identifier — item.id alone is not unique across sprints. */
const compoundKey = (sprintId: string, itemId: number | string) => `${sprintId}::${itemId}`;

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 text-[var(--brand-text-muted)]" />;
  return sortDir === 'asc'
    ? <ChevronUp className="w-3 h-3 text-accent-brand" />
    : <ChevronDown className="w-3 h-3 text-accent-brand" />;
}

export function RoadmapBacklogView({ sprints, filters, featureMap, onToggleStatus }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('priority');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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

  const thStatic = 'px-3 py-2 text-left t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider';
  const sortBtn = 'flex items-center gap-1 text-left t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider hover:text-[var(--brand-text-bright)] focus:outline-none focus:text-accent-brand select-none';

  const ariaSortFor = (col: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

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
    <SectionCard variant="subtle" noPadding>
      <table className="w-full text-xs">
        <thead className="border-b border-[var(--brand-border)]">
          <tr>
            <th className={thStatic} style={{ width: '40px' }} aria-label="Expand row" />
            <th className={thStatic} style={{ width: '52px' }}>#</th>
            <th className={thStatic} style={{ minWidth: '220px' }}>Title</th>
            <th className="px-3 py-2" aria-sort={ariaSortFor('priority')}>
              <Button type="button" variant="ghost" size="sm" className={sortBtn} onClick={() => handleSort('priority')}>
                Priority <SortIcon col="priority" sortKey={sortKey} sortDir={sortDir} />
              </Button>
            </th>
            <th className="px-3 py-2" aria-sort={ariaSortFor('status')}>
              <Button type="button" variant="ghost" size="sm" className={sortBtn} onClick={() => handleSort('status')}>
                Status <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
              </Button>
            </th>
            <th className={thStatic}>Sprint</th>
            <th className={thStatic}>Feature</th>
            <th className={thStatic}>Tags</th>
            <th className="px-3 py-2" aria-sort={ariaSortFor('est')}>
              <Button type="button" variant="ghost" size="sm" className={sortBtn} onClick={() => handleSort('est')}>
                Est <SortIcon col="est" sortKey={sortKey} sortDir={sortDir} />
              </Button>
            </th>
            <th className="px-3 py-2" aria-sort={ariaSortFor('createdAt')}>
              <Button type="button" variant="ghost" size="sm" className={sortBtn} onClick={() => handleSort('createdAt')}>
                Added <SortIcon col="createdAt" sortKey={sortKey} sortDir={sortDir} />
              </Button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--brand-border)]">
          {sorted.map(item => {
            const pb = priorityBadge(item.priority);
            const featureName = item.featureId != null ? featureMap.get(item.featureId) : undefined;
            const key = compoundKey(item.sprintId, item.id);
            const isExpanded = expandedKey === key;

            return (
              <Fragment key={key}>
                <tr className="hover:bg-[var(--surface-3)] transition-colors">
                  <td className="px-2 py-2.5">
                    <IconButton
                      onClick={() => setExpandedKey(isExpanded ? null : key)}
                      aria-expanded={isExpanded}
                      label={isExpanded ? `Collapse details for ${item.title}` : `Expand details for ${item.title}`}
                      icon={isExpanded ? ChevronDown : ChevronRight}
                      size="sm"
                      variant="ghost"
                      className={isExpanded ? 'text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)]'}
                    />
                  </td>
                  <td className="px-3 py-2.5 font-mono t-caption-sm text-[var(--brand-text-muted)]">#{item.id}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        onClick={() => onToggleStatus(item.id, item.sprintId)}
                        variant="ghost"
                        size="sm"
                        className="hover:scale-110 transition-transform flex-shrink-0 focus:outline-none focus:ring-1 focus:ring-teal-400/50 rounded p-0 min-h-0 h-auto"
                        aria-label={`Cycle status (currently ${item.status.replace('_', ' ')})`}
                        title={`Status: ${item.status} — click to cycle`}
                      >
                        {STATUS_ICON[item.status]}
                      </Button>
                      <span className={item.status === 'done' ? 'text-[var(--brand-text-muted)] line-through' : 'text-[var(--brand-text-bright)]'}>
                        {item.title}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge label={pb.label} color={pb.color} />
                  </td>
                  <td className="px-3 py-2.5 text-[var(--brand-text)] capitalize">
                    {item.status.replace('_', ' ')}
                  </td>
                  <td className="px-3 py-2.5 text-[var(--brand-text-muted)] t-caption max-w-[120px] truncate">
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
                  <td className="px-3 py-2.5 text-[var(--brand-text-muted)] whitespace-nowrap">{item.est}</td>
                  <td className="px-3 py-2.5 text-[var(--brand-text-muted)] font-mono t-caption-sm whitespace-nowrap">
                    {item.createdAt ?? '—'}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-[var(--surface-1)]">
                    <td colSpan={10} className="px-4 py-3">
                      <div className="space-y-1.5">
                        {item.notes && (
                          <p className="t-caption text-[var(--brand-text-bright)] leading-relaxed">{item.notes}</p>
                        )}
                        <div className="flex items-center gap-4 t-caption-sm text-[var(--brand-text-muted)]">
                          {item.source && <span>Source: {item.source}</span>}
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
    </SectionCard>
  );
}
