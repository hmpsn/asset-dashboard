import type { RoadmapItem, SprintData } from '../../../../shared/types/roadmap';
import type { RoadmapDisplayRow, RoadmapPriority, RoadmapRuntimeStatus } from './roadmapDisplayTypes';

export type SortKey = 'priority' | 'status' | 'sprint' | 'createdAt' | 'title' | 'est';
export type SortDir = 'asc' | 'desc';

export const STATUS_CYCLE = ['pending', 'in_progress', 'done'] as const satisfies readonly Exclude<RoadmapItem['status'], 'deferred' | 'closed'>[];
export const RUNTIME_STATUSES: readonly RoadmapRuntimeStatus[] = ['pending', 'in_progress', 'done', 'deferred', 'closed'];
export const PRIORITIES: readonly RoadmapPriority[] = ['P0', 'P1', 'P2', 'P3', 'P4'];

const PRIORITY_ORDER: Record<RoadmapPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const STATUS_ORDER: Record<RoadmapRuntimeStatus, number> = { in_progress: 0, pending: 1, deferred: 2, done: 3, closed: 4 };

export const SORT_OPTIONS = [
  { value: 'priority', label: 'Sort: priority' },
  { value: 'status', label: 'Sort: status' },
  { value: 'sprint', label: 'Sort: sprint' },
  { value: 'createdAt', label: 'Sort: added' },
  { value: 'title', label: 'Sort: title' },
  { value: 'est', label: 'Sort: estimate' },
];

export const DIR_OPTIONS = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

export function normalizeRuntimeStatus(value: unknown): RoadmapRuntimeStatus {
  return typeof value === 'string' && RUNTIME_STATUSES.includes(value as RoadmapRuntimeStatus)
    ? value as RoadmapRuntimeStatus
    : 'pending';
}

function estToHours(raw: string): number {
  const value = raw.trim().toLowerCase();
  if (!value || value === '—') return Number.POSITIVE_INFINITY;
  const parts = value.split('-').map((part) => part.trim()).filter(Boolean);
  const parsed = parts.map((part) => {
    const match = part.match(/^(\d+(?:\.\d+)?)\s*([mh])?$/);
    if (!match) return Number.POSITIVE_INFINITY;
    const amount = Number(match[1]);
    const unit = match[2] ?? (value.includes('m') && !value.includes('h') ? 'm' : 'h');
    return unit === 'm' ? amount / 60 : amount;
  });
  if (parsed.some((amount) => !Number.isFinite(amount))) return Number.POSITIVE_INFINITY;
  return parsed.reduce((sum, amount) => sum + amount, 0) / parsed.length;
}

export function compareRows(a: RoadmapDisplayRow, b: RoadmapDisplayRow, sort: SortKey): number {
  if (sort === 'priority') return (a.priority === '—' ? 99 : PRIORITY_ORDER[a.priority]) - (b.priority === '—' ? 99 : PRIORITY_ORDER[b.priority]);
  if (sort === 'status') return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (sort === 'createdAt') return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  if (sort === 'est') return estToHours(a.est) - estToHours(b.est);
  return String(a[sort]).localeCompare(String(b[sort]));
}

export function isSortKey(value: string | null): value is SortKey {
  return SORT_OPTIONS.some((option) => option.value === value);
}

export function isSortDir(value: string | null): value is SortDir {
  return value === 'asc' || value === 'desc';
}

export function makeRows(sprints: SprintData[]): RoadmapDisplayRow[] {
  return sprints.flatMap((sprint) => sprint.items.map((item) => ({
    rowKey: `${sprint.id}::${String(item.id)}`,
    id: `#${String(item.id)}`,
    rawId: item.id,
    sprintId: sprint.id,
    sprint: sprint.name,
    title: item.title,
    status: normalizeRuntimeStatus(item.status),
    priority: item.priority ?? '—',
    est: item.est ?? '—',
    createdAt: item.createdAt ?? null,
    shippedAt: item.shippedAt ?? null,
    source: item.source ?? '—',
    notes: item.notes ?? '',
    tags: item.tags ?? [],
    feature: item.featureId == null ? null : `Feature #${item.featureId}`,
  })));
}

export function shortSprintLabel(name: string) {
  const numeric = name.match(/\bSprint\s+(\d+)\b/i);
  if (numeric) return `S${numeric[1]}`;
  return name.split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
}

/** Keep sprint-header capacity scannable; operational prose belongs in rationale. */
export function formatSprintHours(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(?:h|hr|hrs|hour|hours)?$/i);
  if (!match) return null;
  return `${match[1]}${match[2] ? `–${match[2]}` : ''} hrs`;
}
