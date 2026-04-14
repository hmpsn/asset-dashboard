// ── Deep Diagnostics types ──────────────────────────────────────────

export type DiagnosticStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface DiagnosticReport {
  id: string;
  workspaceId: string;
  insightId: string | null;
  anomalyType: string;
  affectedPages: string[];
  status: DiagnosticStatus;
  diagnosticContext: DiagnosticContext;
  rootCauses: RootCause[];
  remediationActions: RemediationAction[];
  adminReport: string;
  clientSummary: string;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RootCause {
  rank: number;
  title: string;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
  evidence: string[];
}

export interface RemediationAction {
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'high' | 'medium' | 'low';
  owner: 'dev' | 'content' | 'seo';
  pageUrls?: string[];
}

export interface DiagnosticContext {
  anomaly: {
    type: string;
    severity: string;
    metric: string;
    currentValue: number;
    expectedValue: number;
    deviationPercent: number;
    firstDetected: string;
  };
  positionHistory: PositionHistoryPoint[];
  queryBreakdown: QueryBreakdownEntry[];
  redirectProbe: RedirectProbeResult;
  internalLinks: InternalLinksResult;
  backlinks: BacklinksResult;
  siteBaselines: SiteBaselines;
  recentActivity: ActivityEntry[];
  concurrentAnomalies: ConcurrentAnomaly[];
  existingInsights: ExistingInsightSummary[];
  periodComparison: PeriodComparisonResult;
  /** Data sources that were unavailable (integration not configured) */
  unavailableSources: { source: string; reason: string }[];
}

export interface PositionHistoryPoint {
  date: string;
  position: number;
  clicks: number;
  impressions: number;
}

export interface QueryBreakdownEntry {
  query: string;
  currentClicks: number;
  previousClicks: number;
  currentPosition: number;
  previousPosition: number;
  impressionChange: number;
}

export interface RedirectProbeResult {
  chain: { url: string; status: number; location: string | null }[];
  finalStatus: number;
  canonical: string | null;
  isSoftFourOhFour: boolean;
}

export interface InternalLinksResult {
  count: number;
  siteMedian: number;
  topLinkingPages: string[];
  deficit: number;
}

export interface BacklinksResult {
  totalBacklinks: number;
  referringDomains: number;
  topDomains: { domain: string; backlinksCount: number }[];
  /** Best-effort — SEMRush domain-level API may not expose per-URL lost links */
  recentlyLost: number;
}

export interface SiteBaselines {
  avgInternalLinks: number;
  medianPosition: number;
  /** Total backlinks for the domain (not a per-page average). Named for AI clarity. */
  totalBacklinks: number;
}

export interface ActivityEntry {
  date: string;
  action: string;
  details: string;
}

export interface ConcurrentAnomaly {
  type: string;
  page: string;
  severity: string;
}

export interface ExistingInsightSummary {
  type: string;
  severity: string;
  summary: string;
}

export interface PeriodComparisonResult {
  current: { clicks: number; impressions: number; ctr: number; position: number };
  previous: { clicks: number; impressions: number; ctr: number; position: number };
  changePercent: { clicks: number; impressions: number; ctr: number; position: number };
}

/** Input to the orchestrator — passed from the job handler */
export interface DiagnosticRequest {
  workspaceId: string;
  insightId: string;
  reportId: string;
}
