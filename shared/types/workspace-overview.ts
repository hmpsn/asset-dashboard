import type { AuditCategoryScore } from './seo-audit.ts';

export interface WorkspaceOverviewAudit {
  score: number;
  totalPages: number;
  errors: number;
  warnings: number;
  previousScore?: number | null;
  lastAuditDate?: string;
  categoryScoreVersion?: 1;
  categoryScores?: AuditCategoryScore[];
}

export interface WorkspaceOverviewOutcomeValue {
  /** Server-side read excludes `not_acted_on` and sums realized attributed win value only. */
  valuePerMonth: number;
  clicks: number;
  wins: number;
  withValue: number;
  platformExecuted: number;
  externallyExecuted: number;
  notActedOnExcluded: true;
}

export interface WorkspaceOverviewGscRollup {
  connected: boolean;
  dataAvailable: boolean;
  clicks: number;
  /** Organic traffic proxy for the all-client book; currently equals GSC clicks. */
  traffic: number;
  impressions: number;
  /** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
  avgCtr: number;
  avgPosition: number;
  dateRange: { start: string; end: string } | null;
}

export interface WorkspaceOverviewSiteHealthIssue {
  issueType: string;
  label: string;
  category: string;
  severity: 'error' | 'warning' | 'info';
  count: number;
  affectedPages: number;
}

export interface WorkspaceOverviewSiteHealthMatrix {
  workspaceId: string;
  totalIssues: number;
  issues: WorkspaceOverviewSiteHealthIssue[];
}

export interface WorkspaceOverviewItem {
  id: string;
  name: string;
  webflowSiteId: string | null;
  webflowSiteName: string | null;
  hasGsc: boolean;
  hasGa4: boolean;
  hasPassword: boolean;
  tier: 'free' | 'growth' | 'premium';
  isTrial: boolean;
  trialDaysRemaining?: number;
  audit: WorkspaceOverviewAudit | null;
  requests: { total: number; new: number; active: number; latestDate: string | null };
  approvals: { pending: number; approved?: number; changesRequested?: number; total: number };
  contentRequests: {
    pending: number;
    approved?: number;
    changesRequested?: number;
    inProgress: number;
    delivered: number;
    total: number;
  };
  workOrders: { pending: number; total: number };
  contentPlan?: { review: number };
  churnSignals: { critical: number; warning: number };
  clientSignals?: { new: number };
  clientActions?: { approved?: number; changesRequested?: number };
  recResponses?: { approved?: number; declined?: number; discussing?: number };
  issue?: {
    ready: boolean;
    pushedWeekOf: string | null;
    isCurrentWeek: boolean;
    autoSent: { weekOf: string; count: number };
  };
  pageStates: {
    issueDetected: number;
    inReview: number;
    approved: number;
    rejected: number;
    live: number;
    total: number;
  };
  outcomeValue?: WorkspaceOverviewOutcomeValue;
  gscRollup?: WorkspaceOverviewGscRollup;
  siteHealthIssueMatrix?: WorkspaceOverviewSiteHealthMatrix;
}
