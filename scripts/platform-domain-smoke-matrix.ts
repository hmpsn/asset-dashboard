#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';

export const CANONICAL_BOUNDED_CONTEXTS = [
  'workspace-command-center',
  'client-portal',
  'inbox',
  'content-pipeline',
  'schema',
  'seo-health',
  'analytics-intelligence',
  'brand-engine',
  'outcomes-roi',
  'billing-monetization',
  'integrations',
  'platform-foundation',
] as const;

export type BoundedContextId = (typeof CANONICAL_BOUNDED_CONTEXTS)[number];

export type CoverageGroup =
  | 'route'
  | 'read-path'
  | 'write-path'
  | 'public-surface'
  | 'client-surface'
  | 'admin-surface'
  | 'background-job'
  | 'external-provider'
  | 'ai'
  | 'realtime-cache'
  | 'state-machine';

export type DomainSmokeEntry = {
  contextId: BoundedContextId;
  contextName: string;
  corePath: string;
  readPath: string;
  writePath: string;
  cacheOrRealtime: string;
  testCommand: string;
  coverageGroups: CoverageGroup[];
  knownGap: string;
};

export type DomainSmokeGap = {
  contextId: string;
  issue: string;
};

export type DomainSmokeReport = {
  generatedBy: 'scripts/platform-domain-smoke-matrix.ts';
  contextsExpected: BoundedContextId[];
  entries: DomainSmokeEntry[];
  gaps: DomainSmokeGap[];
};

export const PLATFORM_DOMAIN_SMOKE_MATRIX: DomainSmokeEntry[] = [
  {
    contextId: 'workspace-command-center',
    contextName: 'Workspace Command Center',
    corePath: 'Admin workspace overview, workspace settings, reports, and health summary remain readable after workspace setup.',
    readPath: 'GET /api/workspaces, GET /api/workspaces/:id, workspace overview/report routes',
    writePath: 'Workspace create/update/delete routes and workspace-scoped settings writes',
    cacheOrRealtime: 'admin workspace query keys plus workspace:update style invalidation where workspace metadata changes',
    testCommand: 'npx vitest run tests/integration/workspaces.test.ts tests/integration/e2e-workspace-reports.test.ts',
    coverageGroups: ['route', 'read-path', 'write-path', 'admin-surface'],
    knownGap: 'Mobile/admin UI smoke remains a Wave 2b workflow coverage target.',
  },
  {
    contextId: 'client-portal',
    contextName: 'Client Portal',
    corePath: 'Client token login reaches public workspace data, client analytics, and tier-aware portal surfaces.',
    readPath: 'GET /api/public/workspace/:id, public analytics routes, client intelligence routes',
    writePath: 'Client-visible mutations such as content requests, comments, and public review actions',
    cacheOrRealtime: 'client-* React Query keys and workspace-scoped useWorkspaceEvents invalidation',
    testCommand: 'npx vitest run tests/integration/public-portal-auth.test.ts tests/integration/public-analytics.test.ts tests/contract/client-intelligence-tiers.test.ts',
    coverageGroups: ['route', 'read-path', 'public-surface', 'client-surface', 'realtime-cache'],
    knownGap: 'High-value public serialization expansion stays pending in platform-confidence-api-contract-tests.',
  },
  {
    contextId: 'inbox',
    contextName: 'Inbox',
    corePath: 'Admin sends an item, client decides or replies, and admin/client views converge on the updated state.',
    readPath: 'Approval batch, client action, and public inbox/read routes',
    writePath: 'Admin send-to-client, client approve/decline/comment, and admin follow-up mutations',
    cacheOrRealtime: 'approval/client-action workspace broadcasts paired with inbox query invalidation',
    testCommand: 'npx vitest run tests/integration/client-actions-routes.test.ts tests/integration/approvals-routes.test.ts tests/integration/public-approval-broadcasts.test.ts',
    coverageGroups: ['route', 'read-path', 'write-path', 'public-surface', 'client-surface', 'realtime-cache', 'state-machine'],
    knownGap: 'End-to-end admin-to-client-to-admin journey coverage belongs in Wave 2b.',
  },
  {
    contextId: 'content-pipeline',
    contextName: 'Content Pipeline',
    corePath: 'Brief, post, review, publish, and content-plan paths preserve lifecycle state and public review access.',
    readPath: 'Content brief/post/request/review routes and public content review endpoints',
    writePath: 'Brief generation, post save/publish, content requests, content review decisions',
    cacheOrRealtime: 'content-* query keys, content request/review broadcasts, background task progress for long generation',
    testCommand: 'npx vitest run tests/integration/content-brief-routes.test.ts tests/integration/content-posts-workflow.test.ts tests/integration/content-plan-review-routes.test.ts',
    coverageGroups: ['route', 'read-path', 'write-path', 'public-surface', 'admin-surface', 'background-job', 'ai'],
    knownGap: 'More external publishing failure modes remain in the critical coverage sprint.',
  },
  {
    contextId: 'schema',
    contextName: 'Schema',
    corePath: 'Schema generation, validation, review, and CMS publish paths preserve generated schema and validation status.',
    readPath: 'Schema plan, validation, review, and public schema review routes',
    writePath: 'Generate schema, validate schema, send to client, and publish to CMS/Webflow',
    cacheOrRealtime: 'schema query keys, schema validation/publish broadcasts, schema background jobs',
    testCommand: 'npx vitest run tests/integration/schema-entity-graph.test.ts tests/integration/schema-plan-public-routes.test.ts tests/unit/schema-validation-pipeline.test.ts',
    coverageGroups: ['route', 'read-path', 'write-path', 'public-surface', 'admin-surface', 'external-provider', 'ai'],
    knownGap: 'Full Google validator and CMS publish failure matrix remains a Wave 2b target.',
  },
  {
    contextId: 'seo-health',
    contextName: 'SEO Health',
    corePath: 'SEO audits, recommendations, page health, and rewrite workflows read current page/provider data without stale enrichment.',
    readPath: 'SEO audit, recommendations, PageSpeed, page intelligence, and Webflow SEO routes',
    writePath: 'SEO rewrite/save/publish, tracked keyword updates, recommendations resolution',
    cacheOrRealtime: 'seo/page/recommendation query keys and tracked keyword or recommendation broadcasts',
    testCommand: 'npx vitest run tests/integration/seo-audit-routes.test.ts tests/integration/recommendations-routes.test.ts tests/integration/webflow-seo-writes.test.ts',
    coverageGroups: ['route', 'read-path', 'write-path', 'admin-surface', 'external-provider', 'ai', 'realtime-cache'],
    knownGap: 'Provider outage and stale-cache failure cases stay with critical coverage hardening.',
  },
  {
    contextId: 'analytics-intelligence',
    contextName: 'Analytics Intelligence',
    corePath: 'Insights hydrate from analytics/intelligence slices and render typed insight data for admin and client consumers.',
    readPath: 'Analytics insight routes, workspace intelligence facade, client intelligence routes',
    writePath: 'Insight generation/resolution, annotations, anomaly scans, intelligence cache refresh',
    cacheOrRealtime: 'analytics/intelligence query keys, insight broadcasts, workspace intelligence cache invalidation',
    testCommand: 'npx vitest run tests/integration/insights-routes.test.ts tests/unit/workspace-intelligence.test.ts tests/contract/insight-data-shapes.test.ts',
    coverageGroups: ['route', 'read-path', 'write-path', 'client-surface', 'admin-surface', 'ai', 'realtime-cache'],
    knownGap: 'Cross-slice coverage thresholds are tracked in the Wave 2b coverage baseline.',
  },
  {
    contextId: 'brand-engine',
    contextName: 'Brand Engine',
    corePath: 'Voice calibration, brandscript, copy generation, and prompt assembly inject the resolved brand context once.',
    readPath: 'Brand identity, brandscript, voice profile, and prompt assembly reads',
    writePath: 'Voice calibration feedback, brandscript saves, brand identity updates, copy generation writes',
    cacheOrRealtime: 'brand/copy query keys, brand update broadcasts, AI operation prompt contracts',
    testCommand: 'npx vitest run tests/integration/brand-engine-routes.test.ts tests/integration/voice-calibration-hardening.test.ts server/__tests__/prompt-assembly.test.ts',
    coverageGroups: ['route', 'read-path', 'write-path', 'admin-surface', 'ai'],
    knownGap: 'More prompt-render contract tests can be added when the AI operation registry is planned.',
  },
  {
    contextId: 'outcomes-roi',
    contextName: 'Outcomes / ROI',
    corePath: 'Tracked actions, attribution, ROI summaries, and learnings remain consistent across outcome reads and writes.',
    readPath: 'Outcome tracking, ROI attribution, learnings, and action playbook reads',
    writePath: 'Tracked action creation, outcome updates, attribution changes, action playbook resolution',
    cacheOrRealtime: 'outcome/roi query keys and workspace update broadcasts for visible outcome changes',
    testCommand: 'npx vitest run tests/integration/roi-attribution.test.ts tests/integration/outcome-pipeline.test.ts tests/unit/outcome-tracking.test.ts',
    coverageGroups: ['route', 'read-path', 'write-path', 'admin-surface', 'client-surface'],
    knownGap: 'Client narrative ROI workflow tests remain part of Wave 2b client workflow coverage.',
  },
  {
    contextId: 'billing-monetization',
    contextName: 'Billing / Monetization',
    corePath: 'Checkout, webhook, subscription, trial, tier, and entitlement paths agree on the same workspace billing state.',
    readPath: 'Stripe config, usage, subscription, tier, and public/client entitlement reads',
    writePath: 'Checkout session creation, webhook state transitions, trial/tier updates, usage writes',
    cacheOrRealtime: 'billing/tier query keys, workspace billing updates, entitlement revalidation',
    testCommand: 'npx vitest run tests/integration/stripe-api.test.ts tests/integration/stripe-checkout-flow.test.ts tests/integration/tier-gate-enforcement.test.ts',
    coverageGroups: ['route', 'read-path', 'write-path', 'public-surface', 'client-surface', 'external-provider', 'state-machine'],
    knownGap: 'More webhook and cancellation edge cases remain in the Wave 2b auth/billing contract suite.',
  },
  {
    contextId: 'integrations',
    contextName: 'Integrations',
    corePath: 'Provider adapters return normalized data and degrade safely when Webflow, Google, SEMrush, DataForSEO, Stripe, or AI providers fail.',
    readPath: 'Provider config/status routes and normalized provider result reads',
    writePath: 'Provider credential/config updates, CMS writes, provider sync jobs',
    cacheOrRealtime: 'integration/provider query keys, provider sync broadcasts, background task progress for long syncs',
    testCommand: 'npx vitest run tests/integration/semrush-routes.test.ts tests/integration/webflow-cms-writes.test.ts tests/unit/dataforseo-provider.test.ts',
    coverageGroups: ['route', 'read-path', 'write-path', 'external-provider', 'background-job'],
    knownGap: 'Unified external failure classification is a future base-layer recommendation.',
  },
  {
    contextId: 'platform-foundation',
    contextName: 'Platform Foundation',
    corePath: 'Auth, validation, logging, background jobs, broadcasts, route guards, and PR checks keep shared infrastructure reliable.',
    readPath: 'Auth/session reads, job status reads, health routes, generated rule docs',
    writePath: 'Login/session mutations, job start/progress/complete/result writes, shared config updates',
    cacheOrRealtime: 'background task query keys, job progress events, workspace event bus, generated pr-check rule docs',
    testCommand: 'npx vitest run tests/integration/jobs-routes.test.ts tests/integration/broadcast-handler-pairs.test.ts tests/unit/ws-events-constants.test.ts',
    coverageGroups: ['route', 'read-path', 'write-path', 'background-job', 'realtime-cache', 'state-machine'],
    knownGap: 'Full platform verification remains `npm run verify:platform`; this matrix is the fast ownership spine.',
  },
];

function requiredFieldGaps(entry: DomainSmokeEntry): DomainSmokeGap[] {
  const required: Array<keyof DomainSmokeEntry> = [
    'contextName',
    'corePath',
    'readPath',
    'writePath',
    'cacheOrRealtime',
    'testCommand',
    'knownGap',
  ];

  return required
    .filter(field => {
      const value = entry[field];
      return typeof value === 'string' && value.trim().length === 0;
    })
    .map(field => ({
      contextId: entry.contextId,
      issue: `Missing ${field}`,
    }));
}

export function findDomainSmokeMatrixGaps(entries: DomainSmokeEntry[] = PLATFORM_DOMAIN_SMOKE_MATRIX): DomainSmokeGap[] {
  const gaps: DomainSmokeGap[] = [];

  for (const contextId of CANONICAL_BOUNDED_CONTEXTS) {
    const matches = entries.filter(entry => entry.contextId === contextId);
    if (matches.length === 0) gaps.push({ contextId, issue: 'Missing smoke entry' });
    if (matches.length > 1) gaps.push({ contextId, issue: 'Duplicate smoke entries' });
  }

  for (const entry of entries) {
    if (!CANONICAL_BOUNDED_CONTEXTS.includes(entry.contextId)) {
      gaps.push({ contextId: entry.contextId, issue: 'Unknown bounded context' });
    }
    if (entry.coverageGroups.length === 0) {
      gaps.push({ contextId: entry.contextId, issue: 'Missing coverage groups' });
    }
    gaps.push(...requiredFieldGaps(entry));
  }

  return gaps;
}

export function buildPlatformDomainSmokeReport(entries: DomainSmokeEntry[] = PLATFORM_DOMAIN_SMOKE_MATRIX): DomainSmokeReport {
  const sortedEntries = [...entries].sort((a, b) => a.contextId.localeCompare(b.contextId));
  return {
    generatedBy: 'scripts/platform-domain-smoke-matrix.ts',
    contextsExpected: [...CANONICAL_BOUNDED_CONTEXTS],
    entries: sortedEntries,
    gaps: findDomainSmokeMatrixGaps(sortedEntries),
  };
}

export function formatPlatformDomainSmokeReportAsMarkdown(report: DomainSmokeReport = buildPlatformDomainSmokeReport()): string {
  const lines = [
    '# Platform Domain Smoke Matrix',
    '',
    `Contexts expected: ${report.contextsExpected.length}`,
    `Structural gaps: ${report.gaps.length}`,
    '',
    '| Context | Core path | Test command | Coverage groups | Known gap |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const entry of report.entries) {
    lines.push(
      `| \`${entry.contextId}\` | ${entry.corePath} | \`${entry.testCommand}\` | ${entry.coverageGroups.join(', ')} | ${entry.knownGap} |`,
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
  const report = buildPlatformDomainSmokeReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatPlatformDomainSmokeReportAsMarkdown(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
