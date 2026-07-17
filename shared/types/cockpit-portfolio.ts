import type { CockpitVerdict, CockpitVerdictStatus } from './cockpit.js';
import type { WorkQueueClassification, WorkQueueStream } from './work-queue.js';

export interface ReconciledPortfolioMetric<T> {
  status: 'reconciled';
  value: T;
}

export interface UnreconciledPortfolioMetric {
  status: 'not_yet_reconcilable';
  value: null;
  reason: string;
}

export interface CockpitPortfolioAttention {
  rank: number;
  needsAttention: boolean;
  negativeItemCount: number;
  unclassifiedItemCount: number;
  totalItemCount: number;
}

export interface CockpitPortfolioWorkspaceRow {
  workspaceId: string;
  workspaceName: string;
  attention: CockpitPortfolioAttention;
  workQueue: WorkQueueClassification;
  verdict: CockpitVerdict;
}

export interface CockpitPortfolioWorkQueueTotals {
  itemCount: number;
  streams: Record<WorkQueueStream, number>;
}

export type CockpitPortfolioVerdictTotals = Record<CockpitVerdictStatus, number>;

export interface CockpitPortfolioBookTotals {
  workspaces: ReconciledPortfolioMetric<number>;
  attentionNeeded: ReconciledPortfolioMetric<number>;
  workQueue: ReconciledPortfolioMetric<CockpitPortfolioWorkQueueTotals>;
  verdicts: ReconciledPortfolioMetric<CockpitPortfolioVerdictTotals>;
  valueAtStake: UnreconciledPortfolioMetric;
  recoveredSoFar: UnreconciledPortfolioMetric;
}

export interface CockpitPortfolioRollup {
  generatedAt: string;
  workspaces: CockpitPortfolioWorkspaceRow[];
  totals: CockpitPortfolioBookTotals;
}
