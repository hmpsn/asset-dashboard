import db from './db/index.js';
import {
  getExternalApiTelemetry,
  getOperationTraces,
  getSlowRouteTelemetry,
} from './platform-observability.js';
import { getTokenUsage } from './openai-helpers.js';
import type {
  ObservabilityAiFeatureMetric,
  ObservabilityCriticalSyncStatus,
  ObservabilityExternalApiFailureRate,
  ObservabilityFailedJob,
  ObservabilitySlowRouteMetric,
  WorkspaceObservabilityReport,
} from '../shared/types/platform-observability.js';

type BuildObservabilityOptions = {
  since?: string;
  days?: number;
};

type JobRow = {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  created_at: string;
  updated_at: string;
  error: string | null;
  message: string | null;
};

const DEFAULT_DAYS = 14;

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx] ?? null;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function estimateAiCostUsd(entry: {
  promptTokens: number;
  completionTokens: number;
  model: string;
}): number {
  const model = entry.model;
  if (model.startsWith('gpt-5.5')) return (entry.promptTokens * 0.000005) + (entry.completionTokens * 0.00003);
  if (model.startsWith('gpt-5.4-nano')) return (entry.promptTokens * 0.0000002) + (entry.completionTokens * 0.00000125);
  if (model.startsWith('gpt-5.4-mini')) return (entry.promptTokens * 0.00000075) + (entry.completionTokens * 0.0000045);
  if (model.startsWith('gpt-5.4')) return (entry.promptTokens * 0.0000025) + (entry.completionTokens * 0.000015);
  if (model === 'gpt-4.1-nano') return (entry.promptTokens * 0.0000001) + (entry.completionTokens * 0.0000004);
  if (model === 'gpt-4.1-mini') return (entry.promptTokens * 0.0000004) + (entry.completionTokens * 0.0000016);
  if (model.startsWith('gpt-4.1')) return (entry.promptTokens * 0.000002) + (entry.completionTokens * 0.000008);
  if (model.includes('claude-sonnet-4')) return (entry.promptTokens * 0.000003) + (entry.completionTokens * 0.000015);
  if (model.includes('claude-haiku-4-5')) return (entry.promptTokens * 0.000001) + (entry.completionTokens * 0.000005);
  if (model.includes('claude-3-5-sonnet')) return (entry.promptTokens * 0.000003) + (entry.completionTokens * 0.000015);
  if (model.includes('claude-3-5-haiku')) return (entry.promptTokens * 0.0000008) + (entry.completionTokens * 0.000004);
  return (entry.promptTokens * 0.00000075) + (entry.completionTokens * 0.0000045);
}

function buildFailedJobs(workspaceId: string, since: string): ObservabilityFailedJob[] {
  const rows = db.prepare(
    `SELECT id, type, status, created_at, updated_at, error, message
     FROM jobs
     WHERE workspace_id = ?
       AND status IN ('error', 'cancelled')
       AND updated_at >= ?
     ORDER BY updated_at DESC
     LIMIT 100`,
  ).all(workspaceId, since) as JobRow[];

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status === 'cancelled' ? 'cancelled' : 'error',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error ?? undefined,
    message: row.message ?? undefined,
    durationMs: Math.max(0, new Date(row.updated_at).getTime() - new Date(row.created_at).getTime()),
  }));
}

function buildExternalApiRates(workspaceId: string, since: string): ObservabilityExternalApiFailureRate[] {
  const entries = getExternalApiTelemetry({ workspaceId, since });
  const grouped = new Map<string, typeof entries>();

  for (const entry of entries) {
    const bucket = grouped.get(entry.provider) ?? [];
    bucket.push(entry);
    grouped.set(entry.provider, bucket);
  }

  return [...grouped.entries()].map(([provider, group]) => {
    const failed = group.filter(entry => entry.status === 'error').length;
    const latencyValues = group.map(entry => entry.durationMs).filter((value): value is number => typeof value === 'number');
    const successes = group.filter(entry => entry.status === 'success').map(entry => entry.timestamp).sort();
    const errors = group.filter(entry => entry.status === 'error').map(entry => entry.timestamp).sort();
    const totalCalls = group.length;
    const successRatePct = totalCalls === 0 ? 100 : Math.round(((totalCalls - failed) / totalCalls) * 1000) / 10;

    return {
      provider: provider as ObservabilityExternalApiFailureRate['provider'],
      totalCalls,
      failedCalls: failed,
      successRatePct,
      avgLatencyMs: avg(latencyValues),
      p95LatencyMs: p95(latencyValues),
      lastSuccessAt: successes.at(-1) ?? null,
      lastErrorAt: errors.at(-1) ?? null,
    };
  }).sort((a, b) => a.provider.localeCompare(b.provider));
}

function buildAiByFeature(workspaceId: string, since: string): ObservabilityAiFeatureMetric[] {
  const entries = getTokenUsage(workspaceId, since).entries.filter(entry => entry.timestamp >= since);
  const grouped = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = entry.feature;
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()].map(([feature, group]) => {
    const latencyValues = group.map(entry => entry.durationMs).filter((value): value is number => typeof value === 'number' && value >= 0);
    const estimatedCostUsd = group.reduce((sum, entry) => sum + estimateAiCostUsd(entry), 0);
    const totalTokens = group.reduce((sum, entry) => sum + entry.totalTokens, 0);
    return {
      feature,
      calls: group.length,
      totalTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
      avgLatencyMs: avg(latencyValues),
      p95LatencyMs: p95(latencyValues),
      lastCallAt: group.map(entry => entry.timestamp).sort().at(-1) ?? null,
    };
  }).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
}

function buildSlowRoutes(workspaceId: string, since: string): ObservabilitySlowRouteMetric[] {
  const entries = getSlowRouteTelemetry({ workspaceId, since });
  const grouped = new Map<string, typeof entries>();

  for (const entry of entries) {
    const routeKey = `${entry.method} ${entry.path}`;
    const bucket = grouped.get(routeKey) ?? [];
    bucket.push(entry);
    grouped.set(routeKey, bucket);
  }

  return [...grouped.entries()].map(([routeKey, group]) => {
    const durations = group.map(entry => entry.durationMs);
    return {
      routeKey,
      calls: group.length,
      avgDurationMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / group.length),
      p95DurationMs: p95(durations) ?? 0,
      worstDurationMs: Math.max(...durations),
      lastSeenAt: group.map(entry => entry.timestamp).sort().at(-1) ?? new Date().toISOString(),
    };
  }).sort((a, b) => b.worstDurationMs - a.worstDurationMs).slice(0, 20);
}

function readLastSuccessJob(workspaceId: string, type: string): string | null {
  const row = db.prepare(
    `SELECT updated_at
     FROM jobs
     WHERE workspace_id = ?
       AND type = ?
       AND status = 'done'
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).get(workspaceId, type) as { updated_at: string } | undefined;
  return row?.updated_at ?? null;
}

function readLastAuditScheduleRun(workspaceId: string): string | null {
  const row = db.prepare(
    `SELECT last_run_at
     FROM audit_schedules
     WHERE workspace_id = ?
     LIMIT 1`,
  ).get(workspaceId) as { last_run_at: string | null } | undefined;
  return row?.last_run_at ?? null;
}

function readLatestMetricsSnapshot(workspaceId: string): string | null {
  const row = db.prepare(
    `SELECT computed_at
     FROM workspace_metrics_snapshots
     WHERE workspace_id = ?
     ORDER BY computed_at DESC
     LIMIT 1`,
  ).get(workspaceId) as { computed_at: number } | undefined;
  if (!row) return null;
  const numeric = Number(row.computed_at);
  if (!Number.isFinite(numeric)) return null;
  return new Date(numeric).toISOString();
}

function buildCriticalSyncs(
  workspaceId: string,
  externalRates: ObservabilityExternalApiFailureRate[],
): ObservabilityCriticalSyncStatus[] {
  const byProvider = new Map(externalRates.map(rate => [rate.provider, rate]));
  return [
    {
      key: 'seo-audit',
      label: 'SEO Audit',
      lastSuccessAt: readLastSuccessJob(workspaceId, 'seo-audit'),
      detail: 'Background SEO audit pipeline',
    },
    {
      key: 'keyword-strategy',
      label: 'Keyword Strategy',
      lastSuccessAt: readLastSuccessJob(workspaceId, 'keyword-strategy'),
      detail: 'Strategy generation background job',
    },
    {
      key: 'schema-generator',
      label: 'Schema Generator',
      lastSuccessAt: readLastSuccessJob(workspaceId, 'schema-generator'),
      detail: 'Schema generation background job',
    },
    {
      key: 'page-analysis',
      label: 'Page Analysis',
      lastSuccessAt: readLastSuccessJob(workspaceId, 'page-analysis'),
      detail: 'Page intelligence analysis job',
    },
    {
      key: 'audit-schedule',
      label: 'Scheduled Audit Run',
      lastSuccessAt: readLastAuditScheduleRun(workspaceId),
      detail: 'audit_schedules.last_run_at',
    },
    {
      key: 'metrics-snapshot',
      label: 'Metrics Snapshot',
      lastSuccessAt: readLatestMetricsSnapshot(workspaceId),
      detail: 'workspace_metrics_snapshots.computed_at',
    },
    {
      key: 'semrush',
      label: 'SEMRush Provider',
      lastSuccessAt: byProvider.get('semrush')?.lastSuccessAt ?? null,
      detail: byProvider.get('semrush')
        ? `${byProvider.get('semrush')!.failedCalls}/${byProvider.get('semrush')!.totalCalls} failures in window`
        : 'No telemetry in selected window',
    },
    {
      key: 'dataforseo',
      label: 'DataForSEO Provider',
      lastSuccessAt: byProvider.get('dataforseo')?.lastSuccessAt ?? null,
      detail: byProvider.get('dataforseo')
        ? `${byProvider.get('dataforseo')!.failedCalls}/${byProvider.get('dataforseo')!.totalCalls} failures in window`
        : 'No telemetry in selected window',
    },
  ];
}

export function buildWorkspaceObservabilityReport(
  workspaceId: string,
  options?: BuildObservabilityOptions,
): WorkspaceObservabilityReport {
  const generatedAt = new Date().toISOString();
  const days = options?.days ?? DEFAULT_DAYS;
  const since = options?.since ?? (() => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
  })();

  const externalApiFailureRates = buildExternalApiRates(workspaceId, since);
  const report: WorkspaceObservabilityReport = {
    generatedBy: 'server/platform-observability-report.ts',
    generatedAt,
    workspaceId,
    window: {
      since,
      until: generatedAt,
      days,
    },
    failedJobs: buildFailedJobs(workspaceId, since),
    operationTraces: getOperationTraces({ workspaceId, since })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 80),
    externalApiFailureRates,
    aiByFeature: buildAiByFeature(workspaceId, since),
    slowRoutes: buildSlowRoutes(workspaceId, since),
    criticalSyncs: buildCriticalSyncs(workspaceId, externalApiFailureRates),
  };

  return report;
}

export function formatWorkspaceObservabilityReportMarkdown(
  report: WorkspaceObservabilityReport,
): string {
  const lines: string[] = [
    '# Workspace Observability Report',
    '',
    `Workspace: ${report.workspaceId}`,
    `Generated at: ${report.generatedAt}`,
    `Window: ${report.window.since} → ${report.window.until} (${report.window.days}d)`,
    '',
    '## Failed Jobs',
    '',
    '| Type | Status | Duration | Updated | Message |',
    '| --- | --- | --- | --- | --- |',
  ];

  if (report.failedJobs.length === 0) {
    lines.push('| none | - | - | - | - |');
  } else {
    for (const job of report.failedJobs.slice(0, 25)) {
      lines.push(`| ${job.type} | ${job.status} | ${job.durationMs}ms | ${job.updatedAt} | ${(job.error ?? job.message ?? '').replace(/\|/g, '\\|')} |`);
    }
  }

  lines.push('', '## External API Failure Rates', '', '| Provider | Calls | Failed | Success % | Avg ms | P95 ms | Last success | Last error |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  if (report.externalApiFailureRates.length === 0) {
    lines.push('| none | 0 | 0 | 100 | - | - | - | - |');
  } else {
    for (const metric of report.externalApiFailureRates) {
      lines.push(`| ${metric.provider} | ${metric.totalCalls} | ${metric.failedCalls} | ${metric.successRatePct} | ${metric.avgLatencyMs ?? '-'} | ${metric.p95LatencyMs ?? '-'} | ${metric.lastSuccessAt ?? '-'} | ${metric.lastErrorAt ?? '-'} |`);
    }
  }

  lines.push('', '## AI Cost & Latency By Feature', '', '| Feature | Calls | Tokens | Cost (USD) | Avg ms | P95 ms | Last call |', '| --- | --- | --- | --- | --- | --- | --- |');
  if (report.aiByFeature.length === 0) {
    lines.push('| none | 0 | 0 | 0 | - | - | - |');
  } else {
    for (const metric of report.aiByFeature.slice(0, 25)) {
      lines.push(`| ${metric.feature} | ${metric.calls} | ${metric.totalTokens} | ${metric.estimatedCostUsd.toFixed(4)} | ${metric.avgLatencyMs ?? '-'} | ${metric.p95LatencyMs ?? '-'} | ${metric.lastCallAt ?? '-'} |`);
    }
  }

  lines.push('', '## Slow Routes', '', '| Route | Calls | Avg ms | P95 ms | Worst ms | Last seen |', '| --- | --- | --- | --- | --- | --- |');
  if (report.slowRoutes.length === 0) {
    lines.push('| none | 0 | - | - | - | - |');
  } else {
    for (const metric of report.slowRoutes.slice(0, 20)) {
      lines.push(`| ${metric.routeKey.replace(/\|/g, '\\|')} | ${metric.calls} | ${metric.avgDurationMs} | ${metric.p95DurationMs} | ${metric.worstDurationMs} | ${metric.lastSeenAt} |`);
    }
  }

  lines.push('', '## Critical Sync Last Success', '', '| Sync | Last success | Detail |', '| --- | --- | --- |');
  for (const sync of report.criticalSyncs) {
    lines.push(`| ${sync.label} | ${sync.lastSuccessAt ?? '-'} | ${(sync.detail ?? '').replace(/\|/g, '\\|')} |`);
  }

  lines.push('', '## Recent Operation Traces', '', '| Timestamp | Source | Operation | Status | Duration | Message |', '| --- | --- | --- | --- | --- | --- |');
  if (report.operationTraces.length === 0) {
    lines.push('| none | - | - | - | - | - |');
  } else {
    for (const trace of report.operationTraces.slice(0, 40)) {
      lines.push(`| ${trace.timestamp} | ${trace.source} | ${trace.operation.replace(/\|/g, '\\|')} | ${trace.status} | ${trace.durationMs ?? '-'} | ${(trace.message ?? '').replace(/\|/g, '\\|')} |`);
    }
  }

  return `${lines.join('\n')}\n`;
}
