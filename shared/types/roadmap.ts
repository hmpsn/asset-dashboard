// ── Roadmap domain types ────────────────────────────────────────

export interface RoadmapItem {
  /** Numeric for items added via the auto-incrementing pipeline; string for hand-curated phase milestones (e.g. "meeting-brief-phase1"). */
  id: number | string;
  title: string;
  source: string;
  est?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  notes?: string;
  status: 'done' | 'in_progress' | 'pending';
  shippedAt?: string;   // ISO date — set when item first reaches 'done'
  createdAt?: string;   // ISO date — forward-only; undefined for pre-existing items
  featureId?: number;   // soft reference to id field in data/features.json
  tags?: string[];      // free-form labels e.g. ["auth", "infra"]
}

export interface SprintData {
  id: string;
  name: string;
  rationale: string;
  hours: string;
  items: RoadmapItem[];
}
