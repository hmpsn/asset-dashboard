#!/usr/bin/env tsx

import { pathToFileURL } from 'node:url';

import {
  CANONICAL_BOUNDED_CONTEXTS,
  type BoundedContextId,
} from './platform-domain-smoke-matrix.js';

export type CoverageMetric = 'lines' | 'statements' | 'branches' | 'functions';

export type CoverageBaseline = Record<CoverageMetric, number> & {
  measuredAt: string;
};

export type CriticalDomainCoverageEntry = {
  contextId: BoundedContextId;
  contextName: string;
  criticalSurfaces: string[];
  existingTestSignals: string[];
  knownGaps: string[];
  targetCoveragePosture: string;
  recommendedNextTestSlices: string[];
};

export type CriticalDomainCoverageGap = {
  contextId: string;
  issue: string;
};

export type CriticalDomainCoverageReport = {
  generatedBy: 'scripts/report-critical-domain-coverage.ts';
  currentGlobalCoverage: CoverageBaseline;
  contextsExpected: BoundedContextId[];
  entries: CriticalDomainCoverageEntry[];
  gaps: CriticalDomainCoverageGap[];
  advisoryOnly: true;
};

export const CURRENT_GLOBAL_COVERAGE: CoverageBaseline = {
  measuredAt: '2026-05-13',
  lines: 32.31,
  statements: 30.66,
  branches: 24.64,
  functions: 24.30,
};

export const CRITICAL_DOMAIN_COVERAGE_BASELINE: CriticalDomainCoverageEntry[] = [
  {
    contextId: 'workspace-command-center',
    contextName: 'Workspace Command Center',
    criticalSurfaces: ['workspace CRUD', 'workspace overview reads', 'activity feed', 'roadmap/report routes'],
    existingTestSignals: ['tests/integration/workspaces.test.ts', 'tests/integration/e2e-workspace-reports.test.ts'],
    knownGaps: ['admin shell workflow coverage', 'cross-workspace operator smoke coverage'],
    targetCoveragePosture: '70-85% backend line coverage for workspace boundaries; focused admin workflow smoke before UI-heavy changes.',
    recommendedNextTestSlices: ['workspace isolation contract tests', 'overview/report read-path assertions', 'admin shell smoke journey'],
  },
  {
    contextId: 'client-portal',
    contextName: 'Client Portal',
    criticalSurfaces: ['public workspace serialization', 'client auth/session', 'tier-aware portal reads', 'client intelligence'],
    existingTestSignals: ['tests/integration/public-portal-auth.test.ts', 'tests/integration/public-analytics.test.ts', 'tests/contract/client-intelligence-tiers.test.ts'],
    knownGaps: ['public serialization breadth', 'client workflow component coverage', 'tier-gated read-path coverage'],
    targetCoveragePosture: '70-85% public route/read-path line coverage; 60-75% workflow coverage for client UI decisions.',
    recommendedNextTestSlices: ['GET /api/public/workspace/:id contract matrix', 'client login plus tier gate workflow', 'client intelligence read-path contracts'],
  },
  {
    contextId: 'inbox',
    contextName: 'Inbox',
    criticalSurfaces: ['approval batches', 'client actions', 'decision routing', 'admin/client convergence'],
    existingTestSignals: ['tests/integration/client-actions-routes.test.ts', 'tests/integration/approvals-routes.test.ts', 'tests/integration/public-approval-broadcasts.test.ts'],
    knownGaps: ['full admin-send to client-decision to admin-update E2E', 'note-bearing conversation routing coverage'],
    targetCoveragePosture: '70-85% route and state-machine line coverage; high-value E2E smoke for the collaboration loop.',
    recommendedNextTestSlices: ['admin send-to-client journey', 'client approve/decline/comment contracts', 'Inbox section routing regression tests'],
  },
  {
    contextId: 'content-pipeline',
    contextName: 'Content Pipeline',
    criticalSurfaces: ['brief lifecycle', 'post lifecycle', 'content plan review', 'publish/review read paths'],
    existingTestSignals: ['tests/integration/content-brief-routes.test.ts', 'tests/integration/content-posts-workflow.test.ts', 'tests/integration/content-plan-review-routes.test.ts'],
    knownGaps: ['external publish failure modes', 'long-running generation and review journeys', 'public/client serialization breadth'],
    targetCoveragePosture: '70-85% backend workflow line coverage; AI/background-job paths covered by shape, fallback, and failure tests.',
    recommendedNextTestSlices: ['publish failure contract tests', 'public review serialization tests', 'brief-to-post workflow smoke'],
  },
  {
    contextId: 'schema',
    contextName: 'Schema',
    criticalSurfaces: ['schema generation', 'validation', 'client review', 'CMS publish', 'schema context assembly'],
    existingTestSignals: ['tests/integration/schema-entity-graph.test.ts', 'tests/integration/schema-plan-public-routes.test.ts', 'tests/unit/schema-validation-pipeline.test.ts'],
    knownGaps: ['Google validator failure matrix', 'CMS publish edge cases', 'client review workflow breadth'],
    targetCoveragePosture: '70-85% generation/validation line coverage; public review and publish routes covered through actual read/write paths.',
    recommendedNextTestSlices: ['schema public review contract tests', 'validator failure fixtures', 'CMS publish failure assertions'],
  },
  {
    contextId: 'seo-health',
    contextName: 'SEO Health',
    criticalSurfaces: ['audit reads', 'SEO editor writes', 'recommendations', 'page intelligence', 'provider-backed page data'],
    existingTestSignals: ['tests/integration/seo-audit-routes.test.ts', 'tests/integration/recommendations-routes.test.ts', 'tests/integration/webflow-seo-writes.test.ts'],
    knownGaps: ['provider outage behavior', 'stale-cache behavior', 'bulk rewrite workflow breadth'],
    targetCoveragePosture: '70-85% route/write line coverage for high-value page operations; failure states asserted for external writes.',
    recommendedNextTestSlices: ['Webflow failure and no-phantom-success tests', 'recommendation resolution lifecycle', 'bulk rewrite job smoke'],
  },
  {
    contextId: 'analytics-intelligence',
    contextName: 'Analytics Intelligence',
    criticalSurfaces: ['insight generation', 'intelligence slices', 'client/admin insight reads', 'anomaly/recommendation writes'],
    existingTestSignals: ['tests/integration/insights-routes.test.ts', 'tests/unit/workspace-intelligence.test.ts', 'tests/contract/insight-data-shapes.test.ts'],
    knownGaps: ['cross-slice coverage thresholds', 'client narrative workflow tests', 'external analytics outage handling'],
    targetCoveragePosture: '70-85% slice/store line coverage; every insight type has data-shape and renderer/read-path contracts.',
    recommendedNextTestSlices: ['client insight read-path contracts', 'slice population matrix', 'analytics provider failure fixtures'],
  },
  {
    contextId: 'brand-engine',
    contextName: 'Brand Engine',
    criticalSurfaces: ['voice calibration', 'brandscript', 'prompt assembly', 'brand context injection', 'copy generation'],
    existingTestSignals: ['tests/integration/brand-engine-routes.test.ts', 'tests/integration/voice-calibration-hardening.test.ts', 'server/__tests__/prompt-assembly.test.ts'],
    knownGaps: ['prompt-render contract breadth', 'AI operation fallback tests', 'cross-feature brand context regression tests'],
    targetCoveragePosture: '70-85% route/store line coverage; prompt contracts pinned with output-shape and single-injection tests.',
    recommendedNextTestSlices: ['AI operation registry fixtures', 'brandscript public/read contracts', 'voice profile authority tests'],
  },
  {
    contextId: 'outcomes-roi',
    contextName: 'Outcomes / ROI',
    criticalSurfaces: ['tracked actions', 'ROI attribution', 'outcome scorecards', 'learnings/playbooks', 'client wins'],
    existingTestSignals: ['tests/integration/roi-attribution.test.ts', 'tests/integration/outcome-pipeline.test.ts', 'tests/unit/outcome-tracking.test.ts'],
    knownGaps: ['client narrative ROI workflow coverage', 'denominator/rate display contracts', 'external outcome detection breadth'],
    targetCoveragePosture: '70-85% backend line coverage for attribution/scoring; client workflow coverage for visible wins and ROI.',
    recommendedNextTestSlices: ['client wins read-path contracts', 'rate denominator assertions', 'outcome scoring state-machine tests'],
  },
  {
    contextId: 'billing-monetization',
    contextName: 'Billing / Monetization',
    criticalSurfaces: ['checkout', 'webhooks', 'tier/trial state', 'entitlements', 'subscription lifecycle'],
    existingTestSignals: ['tests/integration/stripe-api.test.ts', 'tests/integration/stripe-checkout-flow.test.ts', 'tests/integration/tier-gate-enforcement.test.ts'],
    knownGaps: ['webhook idempotency breadth', 'subscription cancellation edge cases', 'auth/billing boundary matrix'],
    targetCoveragePosture: '75-85% line coverage and 65-75% branch coverage for billing/auth state transitions.',
    recommendedNextTestSlices: ['webhook replay/idempotency tests', 'tier downgrade entitlement tests', 'trial expiry route contracts'],
  },
  {
    contextId: 'integrations',
    contextName: 'Integrations',
    criticalSurfaces: ['Webflow', 'GSC/GA4', 'SEMRush/DataForSEO', 'Stripe', 'OpenAI/Anthropic', 'provider normalization'],
    existingTestSignals: ['tests/integration/semrush-routes.test.ts', 'tests/integration/webflow-cms-writes.test.ts', 'tests/unit/dataforseo-provider.test.ts'],
    knownGaps: ['unified external failure classification', 'provider outage matrix', 'credential/config status smoke'],
    targetCoveragePosture: '70-85% adapter and route line coverage for critical integrations; every external write asserts failure state.',
    recommendedNextTestSlices: ['provider failure contract suite', 'normalized adapter response tests', 'credential status read-path smoke'],
  },
  {
    contextId: 'platform-foundation',
    contextName: 'Platform Foundation',
    criticalSurfaces: ['auth guards', 'validation', 'background jobs', 'broadcasts/cache invalidation', 'state machines', 'pr-check'],
    existingTestSignals: ['tests/integration/jobs-routes.test.ts', 'tests/integration/broadcast-handler-pairs.test.ts', 'tests/unit/ws-events-constants.test.ts'],
    knownGaps: ['domain-specific coverage ratchet', 'tenant boundary audit cadence', 'full platform smoke budget'],
    targetCoveragePosture: '75-85% line coverage and 65-75% branch coverage for shared infrastructure and tenant boundaries.',
    recommendedNextTestSlices: ['tenant-boundary route audit', 'job lifecycle state-machine tests', 'broadcast/listener mutation safety matrix'],
  },
];

function requiredFieldGaps(entry: CriticalDomainCoverageEntry): CriticalDomainCoverageGap[] {
  const gaps: CriticalDomainCoverageGap[] = [];
  if (!entry.contextName.trim()) gaps.push({ contextId: entry.contextId, issue: 'Missing contextName' });
  if (entry.criticalSurfaces.length === 0) gaps.push({ contextId: entry.contextId, issue: 'Missing critical surfaces' });
  if (entry.existingTestSignals.length === 0) gaps.push({ contextId: entry.contextId, issue: 'Missing existing test signals' });
  if (entry.knownGaps.length === 0) gaps.push({ contextId: entry.contextId, issue: 'Missing known gaps' });
  if (!entry.targetCoveragePosture.trim()) gaps.push({ contextId: entry.contextId, issue: 'Missing target coverage posture' });
  if (entry.recommendedNextTestSlices.length === 0) gaps.push({ contextId: entry.contextId, issue: 'Missing recommended next test slices' });
  return gaps;
}

export function findCriticalDomainCoverageGaps(
  entries: CriticalDomainCoverageEntry[] = CRITICAL_DOMAIN_COVERAGE_BASELINE,
): CriticalDomainCoverageGap[] {
  const gaps: CriticalDomainCoverageGap[] = [];

  for (const contextId of CANONICAL_BOUNDED_CONTEXTS) {
    const matches = entries.filter(entry => entry.contextId === contextId);
    if (matches.length === 0) gaps.push({ contextId, issue: 'Missing coverage baseline entry' });
    if (matches.length > 1) gaps.push({ contextId, issue: 'Duplicate coverage baseline entries' });
  }

  for (const entry of entries) {
    if (!CANONICAL_BOUNDED_CONTEXTS.includes(entry.contextId)) {
      gaps.push({ contextId: entry.contextId, issue: 'Unknown bounded context' });
    }
    gaps.push(...requiredFieldGaps(entry));
  }

  return gaps;
}

export function buildCriticalDomainCoverageReport(
  entries: CriticalDomainCoverageEntry[] = CRITICAL_DOMAIN_COVERAGE_BASELINE,
): CriticalDomainCoverageReport {
  const sortedEntries = [...entries].sort((a, b) => a.contextId.localeCompare(b.contextId));
  return {
    generatedBy: 'scripts/report-critical-domain-coverage.ts',
    currentGlobalCoverage: { ...CURRENT_GLOBAL_COVERAGE },
    contextsExpected: [...CANONICAL_BOUNDED_CONTEXTS],
    entries: sortedEntries,
    gaps: findCriticalDomainCoverageGaps(sortedEntries),
    advisoryOnly: true,
  };
}

export function formatCriticalDomainCoverageReportAsMarkdown(
  report: CriticalDomainCoverageReport = buildCriticalDomainCoverageReport(),
): string {
  const coverage = report.currentGlobalCoverage;
  const formatPercent = (value: number) => value.toFixed(2);
  const lines = [
    '# Critical Domain Coverage Baseline',
    '',
    '_Read-only advisory report. Gaps do not fail the command._',
    '',
    `Measured baseline (${coverage.measuredAt}): ${formatPercent(coverage.lines)}% lines, ${formatPercent(coverage.statements)}% statements, ${formatPercent(coverage.branches)}% branches, ${formatPercent(coverage.functions)}% functions.`,
    `Contexts expected: ${report.contextsExpected.length}`,
    `Structural gaps: ${report.gaps.length}`,
    '',
    '| Context | Critical surfaces | Existing test signals | Target posture | Recommended next slices |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const entry of report.entries) {
    lines.push(
      `| \`${entry.contextId}\` | ${entry.criticalSurfaces.join('; ')} | ${entry.existingTestSignals.join('<br>')} | ${entry.targetCoveragePosture} | ${entry.recommendedNextTestSlices.join('; ')} |`,
    );
  }

  if (report.gaps.length > 0) {
    lines.push('', '## Structural Gaps', '');
    for (const gap of report.gaps) {
      lines.push(`- \`${gap.contextId}\`: ${gap.issue}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function runCli(): void {
  const report = buildCriticalDomainCoverageReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatCriticalDomainCoverageReportAsMarkdown(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
