export interface ObservabilityWindow {
  since: string;
  until: string;
  days: number;
}

export interface ObservabilityOperationTrace {
  source: 'job' | 'ai' | 'integration' | 'http';
  operation: string;
  status: 'success' | 'error' | 'warning';
  timestamp: string;
  workspaceId?: string;
  durationMs?: number;
  message?: string;
}

export interface ObservabilityFailedJob {
  id: string;
  type: string;
  status: 'error' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  error?: string;
  message?: string;
  durationMs: number;
}

export interface ObservabilityExternalApiFailureRate {
  provider: 'semrush' | 'dataforseo' | 'google' | 'webflow' | 'other';
  totalCalls: number;
  failedCalls: number;
  successRatePct: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
}

export interface ObservabilityAiFeatureMetric {
  feature: string;
  calls: number;
  totalTokens: number;
  estimatedCostUsd: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  lastCallAt: string | null;
}

export interface ObservabilitySlowRouteMetric {
  routeKey: string;
  calls: number;
  avgDurationMs: number;
  p95DurationMs: number;
  worstDurationMs: number;
  lastSeenAt: string;
}

export interface ObservabilityCriticalSyncStatus {
  key: string;
  label: string;
  lastSuccessAt: string | null;
  detail: string | null;
}

export interface WorkspaceObservabilityReport {
  generatedBy: 'server/platform-observability-report.ts';
  generatedAt: string;
  workspaceId: string;
  window: ObservabilityWindow;
  failedJobs: ObservabilityFailedJob[];
  operationTraces: ObservabilityOperationTrace[];
  externalApiFailureRates: ObservabilityExternalApiFailureRate[];
  aiByFeature: ObservabilityAiFeatureMetric[];
  slowRoutes: ObservabilitySlowRouteMetric[];
  criticalSyncs: ObservabilityCriticalSyncStatus[];
}
