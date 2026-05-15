#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PERFORMANCE_CACHE_EXPECTATIONS = [
  'react-query-event-invalidation',
  'background-job-terminal-state',
  'request-response-no-cache',
] as const;

export const PERFORMANCE_ESCALATION_LEVELS = [
  'warn',
  'investigate',
  'release-block',
] as const;

export type PerformanceCacheExpectation = (typeof PERFORMANCE_CACHE_EXPECTATIONS)[number];
export type PerformanceEscalationLevel = (typeof PERFORMANCE_ESCALATION_LEVELS)[number];

export interface PerformanceEscalationRule {
  level: PerformanceEscalationLevel;
  trigger: string;
  action: string;
}

export interface PerformanceBudgetEntry {
  id: string;
  title: string;
  boundedContext: string;
  owner: string;
  routeOrWorkflow: string;
  isBackgroundJob: boolean;
  aiCallBudget: number;
  externalFetchBudget: number;
  routeResponseTargetMs: number;
  queryCountBudget: number;
  expectedJobDurationMs?: number;
  cacheExpectation: PerformanceCacheExpectation;
  escalation: PerformanceEscalationRule;
  evidence: string[];
  testEvidence: string[];
}

export interface PerformanceBudgetReport {
  generatedBy: 'scripts/performance-budgets.ts';
  generatedAt: string;
  totalEntries: number;
  backgroundJobEntries: number;
  policyGaps: string[];
  counts: {
    cacheExpectations: Record<PerformanceCacheExpectation, number>;
    escalationLevels: Record<PerformanceEscalationLevel, number>;
    contexts: Record<string, number>;
  };
  entries: PerformanceBudgetEntry[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function makeCountMap<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map(value => [value, 0])) as Record<T, number>;
}

function extractLeadingPath(reference: string): string | null {
  const match = reference.match(/^([A-Za-z0-9_./-]+\.[A-Za-z0-9_]+)/);
  return match?.[1] ?? null;
}

function referencePathExists(reference: string): boolean {
  const leadingPath = extractLeadingPath(reference);
  if (!leadingPath) return false;
  return fs.existsSync(path.resolve(ROOT, leadingPath));
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export const PERFORMANCE_BUDGET_REGISTRY: PerformanceBudgetEntry[] = [
  {
    id: 'jobs-keyword-strategy',
    title: 'Keyword Strategy background workflow budget',
    boundedContext: 'seo-strategy',
    owner: 'seo-strategy',
    routeOrWorkflow: 'POST /api/jobs (keyword-strategy)',
    isBackgroundJob: true,
    aiCallBudget: 180,
    externalFetchBudget: 180,
    routeResponseTargetMs: 1200,
    queryCountBudget: 220,
    expectedJobDurationMs: 300000,
    cacheExpectation: 'background-job-terminal-state',
    escalation: {
      level: 'investigate',
      trigger: 'Median duration > 5m or provider failure rate > 20% over 10 runs.',
      action: 'Pause non-critical runs and inspect provider + query-path logs before widening rollout.',
    },
    evidence: [
      'server/routes/jobs.ts (keyword-strategy start + guards)',
      'server/jobs.ts (keyword-strategy worker lifecycle + terminal states)',
    ],
    testEvidence: [
      'tests/integration/keyword-strategy-incremental.test.ts',
      'tests/integration/keyword-strategy-partial-state.test.ts',
    ],
  },
  {
    id: 'jobs-seo-bulk-analyze',
    title: 'SEO bulk analyze workflow budget',
    boundedContext: 'seo-health',
    owner: 'seo-health',
    routeOrWorkflow: 'POST /api/seo/:workspaceId/bulk-analyze',
    isBackgroundJob: true,
    aiCallBudget: 140,
    externalFetchBudget: 180,
    routeResponseTargetMs: 1200,
    queryCountBudget: 240,
    expectedJobDurationMs: 240000,
    cacheExpectation: 'background-job-terminal-state',
    escalation: {
      level: 'investigate',
      trigger: 'Any all-failed completion or p95 duration > 4m for two consecutive runs.',
      action: 'Triage provider saturation and retry path before scheduling additional batches.',
    },
    evidence: [
      'server/routes/webflow-seo-jobs.ts (seo-bulk-analyze starter)',
      'server/seo-audit.ts (analysis execution path)',
    ],
    testEvidence: [
      'tests/integration/seo-audit-routes.test.ts',
      'tests/integration/bulk-analysis-semrush-prefetch.test.ts',
    ],
  },
  {
    id: 'jobs-schema-generator',
    title: 'Schema generator workflow budget',
    boundedContext: 'schema',
    owner: 'schema',
    routeOrWorkflow: 'POST /api/jobs (schema-generator)',
    isBackgroundJob: true,
    aiCallBudget: 160,
    externalFetchBudget: 120,
    routeResponseTargetMs: 1200,
    queryCountBudget: 260,
    expectedJobDurationMs: 360000,
    cacheExpectation: 'background-job-terminal-state',
    escalation: {
      level: 'investigate',
      trigger: 'Validation errors on > 25% of pages in a single run or duration > 6m.',
      action: 'Freeze bulk publish and run schema health dashboard review before client-facing publish.',
    },
    evidence: [
      'server/routes/jobs.ts (schema-generator starter)',
      'server/schema-suggester.ts (generation + persistence pipeline)',
    ],
    testEvidence: [
      'tests/integration/schema-plan-public-routes.test.ts',
      'tests/integration/schema-generator-job-mutation-safety.test.ts',
    ],
  },
  {
    id: 'public-workspace-read',
    title: 'Public workspace bootstrap response budget',
    boundedContext: 'client-portal',
    owner: 'client-portal',
    routeOrWorkflow: 'GET /api/public/workspace/:id',
    isBackgroundJob: false,
    aiCallBudget: 0,
    externalFetchBudget: 0,
    routeResponseTargetMs: 900,
    queryCountBudget: 45,
    cacheExpectation: 'react-query-event-invalidation',
    escalation: {
      level: 'warn',
      trigger: 'p95 response > 900ms or payload hydration misses dashboard sections.',
      action: 'Profile read-path query fanout and tighten serialization before adding new fields.',
    },
    evidence: [
      'server/routes/public-portal.ts (workspace bootstrap serialization)',
      'src/components/ClientDashboard.tsx (workspace bootstrap consumption)',
    ],
    testEvidence: [
      'tests/integration/public-client-serialization-matrix.test.ts',
      'tests/contract/public-client-read-contracts.test.ts',
    ],
  },
  {
    id: 'public-client-chat',
    title: 'Client chat route response budget',
    boundedContext: 'client-chat',
    owner: 'client-chat',
    routeOrWorkflow: 'POST /api/public/search-chat/:workspaceId',
    isBackgroundJob: false,
    aiCallBudget: 1,
    externalFetchBudget: 0,
    routeResponseTargetMs: 30000,
    queryCountBudget: 60,
    cacheExpectation: 'request-response-no-cache',
    escalation: {
      level: 'investigate',
      trigger: 'p95 > 30s or model timeouts > 5% in a 24h window.',
      action: 'Shift to fallback model profile and inspect intelligence payload size before recovery.',
    },
    evidence: [
      'server/routes/public-analytics.ts (chat request handling + AI call)',
      'server/prompt-assembly.ts (system prompt construction)',
    ],
    testEvidence: [
      'tests/integration/tier-gate-enforcement.test.ts',
      'tests/integration/public-portal-auth.test.ts',
    ],
  },
  {
    id: 'admin-overview-read',
    title: 'Admin workspace overview read budget',
    boundedContext: 'command-center',
    owner: 'workspace-overview',
    routeOrWorkflow: 'GET /api/workspace-overview',
    isBackgroundJob: false,
    aiCallBudget: 0,
    externalFetchBudget: 0,
    routeResponseTargetMs: 1200,
    queryCountBudget: 70,
    cacheExpectation: 'react-query-event-invalidation',
    escalation: {
      level: 'warn',
      trigger: 'p95 > 1.2s or stale cards after mutation without realtime invalidation.',
      action: 'Audit query key invalidation + WS events before increasing overview payload breadth.',
    },
    evidence: [
      'server/routes/workspaces.ts (/api/workspace-overview)',
      'src/hooks/admin/useWorkspaceOverview.ts (query consumer)',
    ],
    testEvidence: [
      'tests/integration/workspaces.test.ts',
      'tests/contract/workspace-overview-shape.test.ts',
    ],
  },
];

export function findPerformanceBudgetPolicyGaps(
  entries: PerformanceBudgetEntry[] = PERFORMANCE_BUDGET_REGISTRY,
): string[] {
  const gaps: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      gaps.push(`${entry.id}: duplicate id`);
    }
    seen.add(entry.id);

    if (!entry.title.trim()) gaps.push(`${entry.id}: title is required`);
    if (!entry.owner.trim()) gaps.push(`${entry.id}: owner is required`);
    if (!entry.boundedContext.trim()) gaps.push(`${entry.id}: boundedContext is required`);
    if (!entry.routeOrWorkflow.trim()) gaps.push(`${entry.id}: routeOrWorkflow is required`);

    if (!isNonNegativeInteger(entry.aiCallBudget)) {
      gaps.push(`${entry.id}: aiCallBudget must be a non-negative integer`);
    }
    if (!isNonNegativeInteger(entry.externalFetchBudget)) {
      gaps.push(`${entry.id}: externalFetchBudget must be a non-negative integer`);
    }
    if (!isPositiveInteger(entry.routeResponseTargetMs)) {
      gaps.push(`${entry.id}: routeResponseTargetMs must be a positive integer`);
    }
    if (!isPositiveInteger(entry.queryCountBudget)) {
      gaps.push(`${entry.id}: queryCountBudget must be a positive integer`);
    }

    if (entry.isBackgroundJob) {
      if (!isPositiveInteger(entry.expectedJobDurationMs ?? 0)) {
        gaps.push(`${entry.id}: background jobs require expectedJobDurationMs`);
      }
    } else if (entry.expectedJobDurationMs != null) {
      gaps.push(`${entry.id}: non-background entries must not define expectedJobDurationMs`);
    }

    if (!entry.escalation.trigger.trim()) {
      gaps.push(`${entry.id}: escalation trigger is required`);
    }
    if (!entry.escalation.action.trim()) {
      gaps.push(`${entry.id}: escalation action is required`);
    }

    if (entry.evidence.length === 0) {
      gaps.push(`${entry.id}: at least one code evidence reference is required`);
    }
    if (entry.testEvidence.length === 0) {
      gaps.push(`${entry.id}: at least one test evidence reference is required`);
    }

    for (const reference of entry.evidence) {
      if (!referencePathExists(reference)) {
        gaps.push(`${entry.id}: missing evidence path (${reference})`);
      }
    }
    for (const reference of entry.testEvidence) {
      if (!referencePathExists(reference)) {
        gaps.push(`${entry.id}: missing test evidence path (${reference})`);
      }
    }
  }

  return gaps;
}

export function buildPerformanceBudgetReport(
  entries: PerformanceBudgetEntry[] = PERFORMANCE_BUDGET_REGISTRY,
): PerformanceBudgetReport {
  const cacheCounts = makeCountMap(PERFORMANCE_CACHE_EXPECTATIONS);
  const escalationCounts = makeCountMap(PERFORMANCE_ESCALATION_LEVELS);
  const contextCounts: Record<string, number> = {};

  for (const entry of entries) {
    cacheCounts[entry.cacheExpectation] += 1;
    escalationCounts[entry.escalation.level] += 1;
    contextCounts[entry.boundedContext] = (contextCounts[entry.boundedContext] ?? 0) + 1;
  }

  return {
    generatedBy: 'scripts/performance-budgets.ts',
    generatedAt: new Date().toISOString(),
    totalEntries: entries.length,
    backgroundJobEntries: entries.filter(entry => entry.isBackgroundJob).length,
    policyGaps: findPerformanceBudgetPolicyGaps(entries),
    counts: {
      cacheExpectations: cacheCounts,
      escalationLevels: escalationCounts,
      contexts: contextCounts,
    },
    entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function formatPerformanceBudgetReportMarkdown(
  report: PerformanceBudgetReport = buildPerformanceBudgetReport(),
): string {
  const lines: string[] = [];

  lines.push('# Platform Performance Budget Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Total entries: ${report.totalEntries}`);
  lines.push(`- Background job entries: ${report.backgroundJobEntries}`);
  lines.push(`- Policy gaps: ${report.policyGaps.length}`);
  lines.push('');

  lines.push('## Cache Expectation Coverage');
  for (const expectation of PERFORMANCE_CACHE_EXPECTATIONS) {
    lines.push(`- ${expectation}: ${report.counts.cacheExpectations[expectation]}`);
  }
  lines.push('');

  lines.push('## Escalation Coverage');
  for (const level of PERFORMANCE_ESCALATION_LEVELS) {
    lines.push(`- ${level}: ${report.counts.escalationLevels[level]}`);
  }
  lines.push('');

  lines.push('## Context Coverage');
  for (const context of Object.keys(report.counts.contexts).sort()) {
    lines.push(`- ${context}: ${report.counts.contexts[context]}`);
  }
  lines.push('');

  lines.push('## Policy Gaps');
  if (report.policyGaps.length === 0) {
    lines.push('- none');
  } else {
    for (const gap of report.policyGaps) lines.push(`- ${gap}`);
  }
  lines.push('');

  lines.push('## Budget Registry');
  for (const entry of report.entries) {
    const jobDuration = entry.expectedJobDurationMs != null ? `${entry.expectedJobDurationMs}ms` : 'n/a';
    lines.push(
      `- ${entry.id}: ai=${entry.aiCallBudget}, external=${entry.externalFetchBudget}, routeTarget=${entry.routeResponseTargetMs}ms, queryBudget=${entry.queryCountBudget}, jobDuration=${jobDuration}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export interface PerformanceBudgetCliOptions {
  json: boolean;
  markdown: boolean;
  help: boolean;
}

function printUsage(): void {
  console.error('Usage: npm run verify:performance-budgets -- [--json] [--markdown]');
}

export function parseCliArgs(args: string[]): PerformanceBudgetCliOptions | null {
  let json = false;
  let markdown = false;
  let help = false;

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--markdown') {
      markdown = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    return null;
  }

  if (json && markdown) return null;

  return { json, markdown, help };
}

export async function runCli(rawArgs: string[]): Promise<number> {
  const parsed = parseCliArgs(rawArgs);
  if (!parsed) {
    printUsage();
    return 1;
  }
  if (parsed.help) {
    printUsage();
    return 0;
  }

  const report = buildPerformanceBudgetReport();

  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatPerformanceBudgetReportMarkdown(report));
  }

  if (report.policyGaps.length > 0) {
    console.error('\nPerformance budget policy gaps:');
    for (const gap of report.policyGaps) {
      console.error(`- ${gap}`);
    }
    return 1;
  }

  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then(code => {
      process.exitCode = code;
    })
    .catch(err => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
