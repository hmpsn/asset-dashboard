import type { RoadmapItem } from '../../shared/types/roadmap';

export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export type Status = 'done' | 'in_progress' | 'pending';

export const PRIORITY_VALUES: readonly Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4'];
export const STATUS_VALUES: readonly Status[] = ['done', 'in_progress', 'pending'];

export type FilterValue<T extends string> = 'all' | T;

export interface RoadmapFilters {
  priority: FilterValue<Priority>;
  status: FilterValue<Status>;
  sprint: string;   // 'all' | sprint id (dynamic)
  feature: string;  // 'all' | feature id as string (dynamic; matches String(item.featureId))
  tags: string;     // 'all' | comma-separated tag values (OR semantics)
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
    if (selected.length === 0) return true;
    if (!item.tags || !selected.some(t => item.tags!.includes(t))) return false;
  }
  return true;
}

export type SortKey = 'id' | 'priority' | 'status' | 'est' | 'createdAt';
export type SortDir = 'asc' | 'desc';

export type FlatRoadmapItem = RoadmapItem & { sprintId: string; sprintName: string };

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const STATUS_ORDER: Record<Status, number> = { in_progress: 0, pending: 1, done: 2 };

/**
 * Best-effort numeric estimate (hours) parsed from human-readable strings:
 *   "30m" → 0.5   "1h" → 1   "2-3h" → 2.5 (avg)   "10-14h" → 12
 * Unparseable values sort last (Infinity).
 */
export function estToHours(raw: string | undefined): number {
  if (!raw) return Infinity;
  const s = raw.trim().toLowerCase();
  const isMinutes = s.endsWith('m') && !s.endsWith('h');
  const matches = s.match(/(\d+(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) return Infinity;
  const nums = matches.map(Number);
  const avg = nums.reduce((a, n) => a + n, 0) / nums.length;
  return isMinutes ? avg / 60 : avg;
}

function compareIds(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function sortItems(
  items: FlatRoadmapItem[],
  sortKey: SortKey,
  sortDir: SortDir,
): FlatRoadmapItem[] {
  return [...items].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'priority':
        cmp = (a.priority ? PRIORITY_ORDER[a.priority] : 99) - (b.priority ? PRIORITY_ORDER[b.priority] : 99);
        break;
      case 'status':
        cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
        break;
      case 'createdAt':
        cmp = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
        break;
      case 'est':
        cmp = estToHours(a.est) - estToHours(b.est);
        break;
      default:
        cmp = compareIds(a.id, b.id);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

function coerce<T extends string>(raw: string | null, allowed: readonly T[]): FilterValue<T> {
  if (raw === null || raw === '') return 'all';
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : 'all';
}

function coerceFreeform(raw: string | null): string {
  if (raw === null || raw === '') return 'all';
  return raw;
}

export function filtersFromParams(params: URLSearchParams): RoadmapFilters {
  return {
    priority: coerce(params.get('priority'), PRIORITY_VALUES),
    status: coerce(params.get('status'), STATUS_VALUES),
    sprint: coerceFreeform(params.get('sprint')),
    feature: coerceFreeform(params.get('feature')),
    tags: coerceFreeform(params.get('tags')),
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
