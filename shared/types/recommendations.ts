// ── Recommendation domain types ─────────────────────────────────

export type RecPriority = 'fix_now' | 'fix_soon' | 'fix_later' | 'ongoing';
export type RecType = 'technical' | 'content' | 'content_refresh' | 'schema' | 'metadata' | 'performance' | 'accessibility' | 'strategy' | 'aeo';
export type RecStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed';
export type RecActionType = 'automated' | 'manual' | 'content_creation' | 'purchase';

export interface Recommendation {
  id: string;
  workspaceId: string;
  priority: RecPriority;
  type: RecType;
  title: string;
  description: string;
  insight: string;           // human-readable "why this matters" explanation
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  impactScore: number;       // 0–100, used for sorting
  source: string;            // which check / analysis produced this
  affectedPages: string[];   // page slugs
  trafficAtRisk: number;     // total clicks on affected pages (28d)
  impressionsAtRisk: number; // total impressions on affected pages (28d)
  estimatedGain: string;     // human-readable expected improvement
  actionType: RecActionType;
  productType?: string;      // for purchasable fix upsell
  productPrice?: number;
  status: RecStatus;
  assignedTo?: 'team' | 'client'; // premium → team, growth/free → client
  createdAt: string;
  updatedAt: string;
}

export interface RecommendationSet {
  workspaceId: string;
  generatedAt: string;
  recommendations: Recommendation[];
  summary: {
    fixNow: number;
    fixSoon: number;
    fixLater: number;
    ongoing: number;
    totalImpactScore: number;
    trafficAtRisk: number;
    estimatedRecoverableClicks: number;     // conservative 12% recovery of trafficAtRisk
    estimatedRecoverableImpressions: number;
  };
}
