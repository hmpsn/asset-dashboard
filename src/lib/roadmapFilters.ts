import type { RoadmapItem } from '../../shared/types/roadmap.js';

export interface RoadmapFilters {
  priority: string;  // 'all' | 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
  status: string;    // 'all' | 'done' | 'in_progress' | 'pending'
  sprint: string;    // 'all' | sprint id
  feature: string;   // 'all' | feature id as string (matches String(item.featureId))
  tags: string;      // 'all' | comma-separated tag values (OR semantics)
}

export const DEFAULT_FILTERS: RoadmapFilters = {
  priority: 'all',
  status: 'all',
  sprint: 'all',
  feature: 'all',
  tags: 'all',
};

export function matchesFilters(
  item: RoadmapItem,
  filters: RoadmapFilters,
  sprintId: string,
): boolean {
  if (filters.priority !== 'all' && item.priority !== filters.priority) return false;
  if (filters.status !== 'all' && item.status !== filters.status) return false;
  if (filters.sprint !== 'all' && sprintId !== filters.sprint) return false;
  if (filters.feature !== 'all' && String(item.featureId ?? '') !== filters.feature) return false;
  if (filters.tags !== 'all') {
    const selected = filters.tags.split(',').filter(Boolean);
    if (!item.tags || !selected.some(t => item.tags!.includes(t))) return false;
  }
  return true;
}

export type SortKey = 'id' | 'priority' | 'status' | 'est' | 'createdAt';
export type SortDir = 'asc' | 'desc';

export type FlatRoadmapItem = RoadmapItem & { sprintId: string; sprintName: string };

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const STATUS_ORDER: Record<string, number> = { in_progress: 0, pending: 1, done: 2 };

export function sortItems(
  items: FlatRoadmapItem[],
  sortKey: SortKey,
  sortDir: SortDir,
): FlatRoadmapItem[] {
  return [...items].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'priority':
        cmp = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
        break;
      case 'status':
        cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
        break;
      case 'createdAt':
        cmp = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
        break;
      case 'est':
        cmp = a.est.localeCompare(b.est);
        break;
      default:
        cmp = a.id - b.id;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

export function filtersFromParams(params: URLSearchParams): RoadmapFilters {
  return {
    priority: params.get('priority') ?? 'all',
    status: params.get('status') ?? 'all',
    sprint: params.get('sprint') ?? 'all',
    feature: params.get('feature') ?? 'all',
    tags: params.get('tags') ?? 'all',
  };
}

export function deriveAllTags(sprints: Array<{ items: RoadmapItem[] }>): string[] {
  const set = new Set<string>();
  for (const sprint of sprints) {
    for (const item of sprint.items) {
      item.tags?.forEach(t => set.add(t));
    }
  }
  return Array.from(set).sort();
}
