import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type ProviderProbeStatus = 'passed' | 'failed' | 'skipped';

export interface ProviderProbeResult {
  key: 'integration-health' | 'gsc' | 'ga4' | 'dataforseo' | 'pagespeed' | 'gbp';
  status: ProviderProbeStatus;
  httpStatus?: number;
  detail: string;
}

export interface ProviderReadinessSmokeReport {
  profile: 'staging';
  baseUrl: string;
  workspaceId: string;
  generatedAt: string;
  readOnly: true;
  maxPaidCalls: number;
  probes: ProviderProbeResult[];
  passed: boolean;
}

export interface ProviderReadinessSmokeOptions {
  profile: 'staging';
  baseUrl: string;
  workspaceId: string;
  appPassword: string;
  maxPaidCalls: number;
  pageSpeedUrl?: string;
  outputPath?: string;
}

type FetchLike = typeof fetch;

function argValue(args: string[], key: string): string | undefined {
  const equals = args.find(arg => arg.startsWith(`${key}=`));
  if (equals) return equals.slice(key.length + 1);
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('max-paid-calls must be a non-negative integer');
  return parsed;
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('base URL must use HTTPS outside localhost');
  }
  if (parsed.hostname === 'insights.hmpsn.studio') {
    throw new Error('provider smoke refuses the production platform origin');
  }
  return value.replace(/\/+$/, '');
}

export function parseProviderReadinessSmokeOptions(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ProviderReadinessSmokeOptions {
  const profile = argValue(args, '--profile') ?? 'staging';
  if (profile !== 'staging') throw new Error('provider smoke supports only --profile=staging');
  const baseUrl = argValue(args, '--base-url') ?? env.STAGING_BASE_URL ?? '';
  const workspaceId = argValue(args, '--workspace-id') ?? env.STAGING_WORKSPACE_ID ?? '';
  const appPassword = env.APP_PASSWORD ?? '';
  if (!baseUrl) throw new Error('STAGING_BASE_URL or --base-url is required');
  if (!workspaceId) throw new Error('STAGING_WORKSPACE_ID or --workspace-id is required');
  if (!appPassword) throw new Error('APP_PASSWORD is required');
  return {
    profile,
    baseUrl: normalizeBaseUrl(baseUrl),
    workspaceId,
    appPassword,
    maxPaidCalls: positiveInt(
      argValue(args, '--max-paid-calls') ?? env.PROVIDER_SMOKE_MAX_PAID_CALLS,
      1,
    ),
    pageSpeedUrl: argValue(args, '--pagespeed-url') ?? env.PROVIDER_SMOKE_PAGESPEED_URL,
    outputPath: argValue(args, '--output') ?? env.PROVIDER_SMOKE_OUTPUT,
  };
}

function safeDetail(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Response received';
  const record = value as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error.slice(0, 180);
  if (Array.isArray(record.items)) return `${record.items.length} item(s)`;
  if (Array.isArray(record.integrations)) return `${record.integrations.length} integration(s)`;
  if (Array.isArray(record.trend)) return `${record.trend.length} trend point(s)`;
  if (Array.isArray(record.competitors)) return `${record.competitors.length} competitor(s)`;
  return 'Response received';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    void error;
    return null;
  }
}

async function getProbe(
  fetchImpl: FetchLike,
  options: ProviderReadinessSmokeOptions,
  key: ProviderProbeResult['key'],
  pathname: string,
): Promise<ProviderProbeResult> {
  try {
    const response = await fetchImpl(`${options.baseUrl}${pathname}`, {
      method: 'GET',
      headers: { 'x-auth-token': options.appPassword },
    });
    const body = await readJson(response);
    return {
      key,
      status: response.ok ? 'passed' : 'failed',
      httpStatus: response.status,
      detail: safeDetail(body),
    };
  } catch (error) {
    return {
      key,
      status: 'failed',
      detail: error instanceof Error ? error.message.slice(0, 180) : 'Request failed',
    };
  }
}

async function getPageSpeedProbe(
  fetchImpl: FetchLike,
  options: ProviderReadinessSmokeOptions,
  pathname: string,
): Promise<ProviderProbeResult> {
  try {
    const response = await fetchImpl(`${options.baseUrl}${pathname}`, {
      method: 'GET',
      headers: { 'x-auth-token': options.appPassword },
    });
    const body = await readJson(response) as { pages?: Array<{ url?: string }> } | null;
    const expectedUrl = options.pageSpeedUrl;
    const targetPresent = !expectedUrl || body?.pages?.some(page => page.url === expectedUrl) === true;
    return {
      key: 'pagespeed',
      status: response.ok && targetPresent ? 'passed' : 'failed',
      httpStatus: response.status,
      detail: response.ok && !targetPresent
        ? 'Configured PageSpeed smoke target is absent from the saved snapshot'
        : safeDetail(body),
    };
  } catch (error) {
    return {
      key: 'pagespeed',
      status: 'failed',
      detail: error instanceof Error ? error.message.slice(0, 180) : 'Request failed',
    };
  }
}

export async function runProviderReadinessSmoke(
  options: ProviderReadinessSmokeOptions,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderReadinessSmokeReport> {
  const encodedWorkspace = encodeURIComponent(options.workspaceId);
  const workspaceResponse = await fetchImpl(`${options.baseUrl}/api/workspaces/${encodedWorkspace}`, {
    method: 'GET',
    headers: { 'x-auth-token': options.appPassword },
  });
  const workspace = await readJson(workspaceResponse) as {
    webflowSiteId?: string;
    gscPropertyUrl?: string;
    liveDomain?: string;
    competitorDomains?: string[];
  } | null;

  const probes: ProviderProbeResult[] = [];
  probes.push(await getProbe(fetchImpl, options, 'integration-health', `/api/integrations/health/${encodedWorkspace}`));

  if (workspaceResponse.ok && workspace?.webflowSiteId && workspace.gscPropertyUrl) {
    const query = new URLSearchParams({
      workspaceId: options.workspaceId,
      gscSiteUrl: workspace.gscPropertyUrl,
      days: '28',
    });
    probes.push(await getProbe(
      fetchImpl,
      options,
      'gsc',
      `/api/google/search-overview/${encodeURIComponent(workspace.webflowSiteId)}?${query}`,
    ));
  } else {
    probes.push({ key: 'gsc', status: 'skipped', detail: 'Workspace has no GSC property and site target' });
  }

  probes.push(await getProbe(fetchImpl, options, 'ga4', `/api/google/analytics-overview/${encodedWorkspace}?days=28`));

  if (options.maxPaidCalls > 0 && workspace?.liveDomain) {
    probes.push(await getProbe(
      fetchImpl,
      options,
      'dataforseo',
      `/api/seo/discover-competitors/${encodedWorkspace}`,
    ));
  } else {
    probes.push({
      key: 'dataforseo',
      status: 'skipped',
      detail: options.maxPaidCalls === 0 ? 'Paid provider calls disabled' : 'No live domain configured',
    });
  }

  if (workspace?.webflowSiteId) {
    const query = new URLSearchParams({ workspaceId: options.workspaceId, strategy: 'mobile' });
    probes.push(await getPageSpeedProbe(
      fetchImpl,
      options,
      `/api/webflow/pagespeed-snapshot/${encodeURIComponent(workspace.webflowSiteId)}?${query}`,
    ));
  } else {
    probes.push({ key: 'pagespeed', status: 'skipped', detail: 'Workspace has no PageSpeed target' });
  }

  const gbpStatus = await getProbe(fetchImpl, options, 'gbp', '/api/google-business-profile/status');
  if (gbpStatus.status === 'passed') {
    const reviews = await getProbe(
      fetchImpl,
      options,
      'gbp',
      `/api/google-business-profile/workspaces/${encodedWorkspace}/reviews`,
    );
    probes.push({ ...reviews, detail: `Connection: ${gbpStatus.detail}; reviews: ${reviews.detail}` });
  } else {
    probes.push(gbpStatus);
  }

  const report: ProviderReadinessSmokeReport = {
    profile: 'staging',
    baseUrl: options.baseUrl,
    workspaceId: options.workspaceId,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    maxPaidCalls: options.maxPaidCalls,
    probes,
    passed: !probes.some(probe => probe.status === 'failed'),
  };
  return report;
}

export function writeProviderReadinessReport(report: ProviderReadinessSmokeReport, outputPath: string): void {
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  const options = parseProviderReadinessSmokeOptions(process.argv.slice(2));
  const report = await runProviderReadinessSmoke(options);
  if (options.outputPath) writeProviderReadinessReport(report, options.outputPath);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  main().catch(error => {
    process.stderr.write(`Provider readiness smoke failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    process.exitCode = 1;
  });
}
