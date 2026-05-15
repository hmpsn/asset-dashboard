export type IntegrationHealthState = 'configured' | 'missing' | 'degraded';

export type IntegrationQuotaStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export type IntegrationKey =
  | 'webflow'
  | 'google'
  | 'gsc'
  | 'ga4'
  | 'semrush'
  | 'dataforseo'
  | 'stripe'
  | 'openai'
  | 'anthropic'
  | 'email';

export interface IntegrationHealthItem {
  key: IntegrationKey;
  label: string;
  state: IntegrationHealthState;
  configured: boolean;
  connected?: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  quotaStatus: IntegrationQuotaStatus;
  quotaDetail: string | null;
  tokenExpiresAt: string | null;
  affectedFeatures: string[];
  notes: string | null;
}

export interface IntegrationHealthSummary {
  configured: number;
  missing: number;
  degraded: number;
  healthy: number;
}

export interface WorkspaceIntegrationHealth {
  workspaceId: string;
  generatedAt: string;
  summary: IntegrationHealthSummary;
  integrations: IntegrationHealthItem[];
}
