// ── Roadmap domain types ────────────────────────────────────────

export interface RoadmapItem {
  id: number;
  title: string;
  source: string;
  est: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  notes: string;
  status: 'done' | 'in_progress' | 'pending';
  shippedAt?: string;
}

export interface SprintData {
  id: string;
  name: string;
  rationale: string;
  hours: string;
  items: RoadmapItem[];
}
