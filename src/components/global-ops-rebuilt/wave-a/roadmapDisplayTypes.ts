import type { RoadmapItem } from '../../../../shared/types/roadmap';

export type RoadmapRuntimeStatus = RoadmapItem['status'] | 'deferred';
export type RoadmapPriority = NonNullable<RoadmapItem['priority']>;

export interface RoadmapDisplayRow {
  rowKey: string;
  id: string;
  rawId: RoadmapItem['id'];
  sprintId: string;
  sprint: string;
  title: string;
  status: RoadmapRuntimeStatus;
  priority: RoadmapPriority | '—';
  est: string;
  createdAt: string | null;
  shippedAt: string | null;
  source: string;
  notes: string;
  tags: string[];
  feature: string | null;
}

export interface RoadmapDisplayGroup {
  id: string;
  name: string;
  rationale: string | null;
  hours: string | null;
  done: number;
  total: number;
  rows: RoadmapDisplayRow[];
}

export interface VelocityPoint {
  id: string;
  label: string;
  fullLabel: string;
  count: number;
}
