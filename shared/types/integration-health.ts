export type IntegrationHealthState = 'configured' | 'missing' | 'degraded';

export type IntegrationVerificationStatus = 'not_checked' | 'verified' | 'failed' | 'unsupported';

export type IntegrationQuotaStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export type IntegrationKey =
  | 'webflow'
  | 'google'
  | 'gsc'
  | 'ga4'
  | 'dataforseo'
  | 'pagespeed'
  | 'gbp'
  | 'stripe'
  | 'openai'
  | 'anthropic'
  | 'email';

export interface IntegrationCapabilityHealth {
  key: string;
  label: string;
  available: boolean | null;
  detail: string | null;
}

export interface IntegrationHealthItem {
  key: IntegrationKey;
  label: string;
  state: IntegrationHealthState;
  configured: boolean;
  connected?: boolean;
  verificationStatus?: IntegrationVerificationStatus;
  capabilities?: IntegrationCapabilityHealth[];
  providerMode?: 'live' | 'local-fixture';
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
