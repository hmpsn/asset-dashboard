#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEPRECATION_STATES = [
  'deprecated',
  'hidden',
  'read-only',
  'migrated',
  'removed',
] as const;

export const DEPRECATION_CONTRACT_KINDS = [
  'redirect',
  'safe-failure',
  'read-only-enforcement',
  'visibility-gate',
  'migration',
] as const;

export type DeprecationState = (typeof DEPRECATION_STATES)[number];
export type DeprecationContractKind = (typeof DEPRECATION_CONTRACT_KINDS)[number];

export interface DeprecationContract {
  kind: DeprecationContractKind;
  description: string;
  evidence: string;
  testEvidence: string;
}

export interface DeprecationEntry {
  id: string;
  capability: string;
  state: DeprecationState;
  owner: string;
  replacement?: string;
  requiresHumanVerification: boolean;
  notes: string;
  contracts: DeprecationContract[];
}

export interface DeprecationLifecycleReport {
  generatedBy: 'scripts/deprecation-lifecycle.ts';
  generatedAt: string;
  totalEntries: number;
  humanReviewRequired: number;
  missingStates: DeprecationState[];
  policyGaps: string[];
  counts: {
    states: Record<DeprecationState, number>;
    contracts: Record<DeprecationContractKind, number>;
  };
  entries: DeprecationEntry[];
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

function hasContract(entry: DeprecationEntry, kind: DeprecationContractKind): boolean {
  return entry.contracts.some(contract => contract.kind === kind);
}

export const DEPRECATION_REGISTRY: DeprecationEntry[] = [
  {
    id: 'client-inbox-legacy-route-aliases',
    capability: 'Legacy client route aliases (/approvals, /requests, /content)',
    state: 'removed',
    owner: 'inbox',
    replacement: 'Use /client/:workspaceId/inbox?tab=decisions|conversations|reviews.',
    requiresHumanVerification: true,
    notes: 'Removed 2026-06-14 after the unified Inbox became the live client experience. Retired paths no longer redirect; they fall through to the dashboard safe fallback.',
    contracts: [
      {
        kind: 'safe-failure',
        description: 'Retired route aliases are no longer accepted as renderable client tabs and fall back to the dashboard overview path.',
        evidence: 'src/lib/client-dashboard-tab.ts (retired aliases omitted from KNOWN_CLIENT_TABS)',
        testEvidence: 'tests/unit/client-dashboard-tab-routing.test.ts (retired route alias fallback assertions)',
      },
    ],
  },
  {
    id: 'client-approvals-tab-removed',
    capability: 'Legacy ApprovalsTab client component',
    state: 'removed',
    owner: 'inbox',
    replacement: 'Use UnifiedInbox with InlineApprovalCard and DecisionDetailModal over /api/public/deliverables.',
    requiresHumanVerification: true,
    notes: 'Removed 2026-06-13 after the unified inbox became the canonical client approval surface. RequestsTab and SchemaReviewTab remain live and were intentionally retained.',
    contracts: [
      {
        kind: 'safe-failure',
        description: 'The canonical inbox renders approval decisions, and a contract test asserts the retired ApprovalsTab file stays absent.',
        evidence: 'src/components/client/inbox/UnifiedInbox.tsx (canonical client inbox approval renderer)',
        testEvidence: 'tests/contract/client-data-react-query.test.ts (retired ApprovalsTab deletion assertion)',
      },
    ],
  },
  {
    id: 'legacy-approval-apply-route-deprecated',
    capability: 'Legacy approval apply route (POST /api/public/approvals/:workspaceId/:batchId/apply)',
    state: 'deprecated',
    owner: 'inbox',
    replacement: 'Use POST /api/public/deliverables/:workspaceId/:id/apply.',
    requiresHumanVerification: true,
    notes: 'Deprecated 2026-06-13. Compatibility remains for old clients, but the canonical client API now applies by deliverable id and resolves the legacy batch source server-side.',
    contracts: [
      {
        kind: 'safe-failure',
        description: 'Legacy apply calls continue to work but return an X-Deprecated-Route header pointing at the canonical deliverable apply URL.',
        evidence: 'server/routes/approvals.ts (X-Deprecated-Route compatibility header)',
        testEvidence: 'tests/integration/r3b-apply-to-website.test.ts (deprecated compatibility route assertion)',
      },
    ],
  },
  {
    id: 'keyword-value-scoring-dark-launch',
    capability: 'Keyword Hub value-first opportunity scoring (was dark-launched behind keyword-value-scoring)',
    state: 'removed',
    owner: 'analytics-intelligence',
    replacement: 'Value-first opportunity scoring (computeKeywordValueScore) is now the only Hub sort path — unconditional.',
    requiresHumanVerification: true,
    notes: 'Retired in SEO Decision Engine P1 (2026-06-23). The keyword-value-scoring flag was removed from FEATURE_FLAGS/catalog/groups and the crude computeOpportunityScore Hub-sort branches were deleted; value-first scoring is unconditional. computeOpportunityScore is kept as the value-first signal-gate fallback and the backfill/briefing/public-projection basis. Staging eyeball of admin Hub + client Strategy keyword ordering before promotion.',
    contracts: [
      {
        kind: 'safe-failure',
        description: 'The keyword-value-scoring flag is removed from FEATURE_FLAGS/catalog/groups and the crude Hub-sort accessors are deleted, so no flag-OFF path resurrects the crude volume×ease score.',
        evidence: 'shared/types/feature-flags.ts (keyword-value-scoring absent from FEATURE_FLAGS/catalog/groups)',
        testEvidence: 'tests/unit/feature-flags-keyword-hub.test.ts (keyword-value-scoring fully retired assertions)',
      },
      {
        kind: 'read-only-enforcement',
        description: 'pr-check bans reintroducing the keyword-value-scoring flag key into any flag API.',
        evidence: 'scripts/pr-check.ts (Retired Keyword Hub feature flag key used in flag API)',
        testEvidence: 'tests/pr-check.test.ts (flags the retired keyword-value-scoring flag re-added to a flag API)',
      },
    ],
  },
  {
    id: 'keyword-universe-full-dark-launch',
    capability: 'Keyword Hub full keyword universe — uncapped coverage + junk gate (dark-launched behind keyword-universe-full)',
    state: 'hidden',
    owner: 'analytics-intelligence',
    replacement: 'Enable the keyword-universe-full flag to swap the cap-based keyword coverage for the uncapped full universe (all GSC-clicked/impressed + discovery).',
    requiresHumanVerification: false,
    notes: 'The full keyword universe ships behind a default-OFF flag so cap-based vs uncapped coverage is comparable on staging; the flag-OFF path keeps the cap-based coverage. Removal condition: validate on staging, make it the default, then delete the cap-based path.',
    contracts: [
      {
        kind: 'visibility-gate',
        description: 'Keyword coverage is uncapped only when keyword-universe-full is ON; OFF keeps the cap-based path (byte-identical to pre-flag).',
        evidence: 'shared/types/feature-flags.ts (keyword-universe-full default false in FEATURE_FLAGS)',
        testEvidence: 'tests/unit/feature-flags-keyword-hub.test.ts (keyword-universe-full survives, defaults OFF, in Keyword Hub group)',
      },
    ],
  },
  {
    id: 'keyword-command-center-standalone-surface',
    capability: 'Standalone Keyword Command Center admin surface (KeywordCommandCenter.tsx)',
    state: 'removed',
    owner: 'analytics-intelligence',
    replacement: 'Use the unified Keyword Hub at /ws/:workspaceId/seo-keywords (KeywordHub.tsx).',
    requiresHumanVerification: true,
    notes: 'Removed at the Keyword Hub cutover (2026-06-11). The legacy KeywordCommandCenter renderer was deleted; the Hub consumes the surviving server module (server/keyword-command-center.ts) and shared types. The keyword-hub umbrella flag was retired in the same cutover.',
    contracts: [
      {
        kind: 'safe-failure',
        description: 'The keyword-hub flag is retired from FEATURE_FLAGS/catalog/groups, and its production override is dropped, so no flag-OFF path resurrects the legacy surface.',
        evidence: 'shared/types/feature-flags.ts (keyword-hub absent from FEATURE_FLAGS; migration 135 drops overrides)',
        testEvidence: 'tests/unit/feature-flags-keyword-hub.test.ts (keyword-hub fully retired assertions)',
      },
      {
        kind: 'read-only-enforcement',
        description: 'pr-check bans reintroducing the keyword-hub flag key into any flag API.',
        evidence: 'scripts/pr-check.ts (Retired Keyword Hub feature flag key used in flag API)',
        testEvidence: 'tests/pr-check.test.ts (Rule: Retired Keyword Hub feature flag key used in flag API)',
      },
    ],
  },
  {
    id: 'rank-tracker-standalone-surface',
    capability: 'Standalone Rank Tracker admin surface (RankTracker.tsx) + its untrack endpoint',
    state: 'removed',
    owner: 'analytics-intelligence',
    replacement: 'Rank history, positions, snapshots, and the pin toggle are surfaced in the Keyword Hub detail drawer (seo-keywords).',
    requiresHumanVerification: true,
    notes: 'Removed at the Keyword Hub cutover (2026-06-11). RankTracker.tsx and the RankTracker-only DELETE /api/rank-tracking/:workspaceId/keywords/:query untrack endpoint were deleted; the PATCH .../pin endpoint survives (the Hub drawer uses it). Hub hard-delete + lifecycle-retire are the surviving keyword-removal paths.',
    contracts: [
      {
        kind: 'safe-failure',
        description: 'The RankTracker-only untrack route was removed; its admin route test no longer exercises it (the pin route and KCC hard-delete remain).',
        evidence: 'server/routes/rank-tracking.ts (no DELETE /keywords/:query route; pin route retained)',
        testEvidence: 'tests/integration/rank-tracking-routes.test.ts (DELETE route case removed; pin + CRUD retained)',
      },
    ],
  },
  {
    id: 'seo-ranks-route-folded-into-hub',
    capability: 'seo-ranks Page route (the standalone Rank Tracker URL)',
    state: 'removed',
    owner: 'analytics-intelligence',
    replacement: 'Use seo-keywords (the Keyword Hub). Old seo-ranks deep-links redirect via App.tsx.',
    requiresHumanVerification: true,
    notes: 'Folded into the Keyword Hub at the cutover (2026-06-11). The frontend lane removed every seo-ranks reference from src/; a transitional redirect preserves bookmarks through the soak window.',
    contracts: [
      {
        kind: 'safe-failure',
        description: 'Old seo-ranks intents redirect to seo-keywords rather than rendering a dead surface, and a pr-check rule bans the literal returning to src/.',
        evidence: 'scripts/pr-check.ts (Retired seo-ranks route literal in src)',
        testEvidence: 'tests/pr-check.test.ts (Rule: Retired seo-ranks route literal in src)',
      },
    ],
  },
  {
    id: 'keyword-strategy-legacy-sse-route',
    capability: 'Legacy keyword strategy SSE generation route (POST /api/webflow/keyword-strategy/:workspaceId)',
    state: 'deprecated',
    owner: 'analytics-intelligence',
    replacement: 'Start BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY through /api/jobs.',
    requiresHumanVerification: true,
    notes: 'The first-party UI uses durable background jobs; the legacy route remains only for external compatibility during retirement.',
    contracts: [
      {
        kind: 'safe-failure',
        description: 'Legacy route responds with explicit deprecation guidance while preserving compatibility.',
        evidence: 'server/routes/keyword-strategy.ts (X-Deprecated-Route compatibility header)',
        testEvidence: 'tests/contract/keyword-strategy-compat-retirement.test.ts',
      },
    ],
  },
  {
    id: 'keyword-strategy-client-action-read-only',
    capability: 'Deprecated keyword_strategy client action source type (archived rows only)',
    state: 'read-only',
    owner: 'inbox',
    replacement: 'Use SEO Strategy + Inbox-native source types for new decision flows.',
    requiresHumanVerification: true,
    notes: 'Legacy rows remain readable for historical context, but new writes are blocked by policy checks.',
    contracts: [
      {
        kind: 'read-only-enforcement',
        description: 'Guardrail blocks reintroduction of new keyword_strategy source writes in UI code.',
        evidence: 'docs/rules/automated-rules.md (keyword-strategy-action-type)',
        testEvidence: 'tests/pr-check.test.ts (Rule: keyword-strategy-action-type)',
      },
    ],
  },
  {
    id: 'schema-review-standalone-tab-migration',
    capability: 'Schema Review standalone tab retired into Inbox Reviews workflow',
    state: 'migrated',
    owner: 'inbox',
    replacement: 'Use /client/:workspaceId/inbox?tab=reviews and the SchemaReviewModal entry point.',
    requiresHumanVerification: true,
    notes: 'Migrated into Inbox Reviews. On 2026-06-14 the legacy standalone route redirect was removed; the old tab segment now follows the normal unknown-tab fallback.',
    contracts: [
      {
        kind: 'migration',
        description: 'The schema review workflow is available through the Inbox Reviews modal rather than a standalone client tab.',
        evidence: 'src/components/client/SchemaReviewModal.tsx (Inbox-mounted schema review modal)',
        testEvidence: 'tests/components/client/inbox-components.test.tsx (SchemaReviewModal render assertions)',
      },
      {
        kind: 'safe-failure',
        description: 'Unknown or retired tab values safely fall back instead of blank rendering.',
        evidence: 'src/lib/client-dashboard-tab.ts (unknown tab fallback -> overview)',
        testEvidence: 'tests/unit/client-dashboard-tab-routing.test.ts (unknown tab fallback assertions)',
      },
    ],
  },
  {
    id: 'feedback-endpoints-and-widget-retirement',
    capability: 'Legacy feedback module and /api/feedback surfaces',
    state: 'removed',
    owner: 'inbox',
    replacement: 'Use Inbox conversations/requests and modern client suggestion flows.',
    requiresHumanVerification: true,
    notes: 'Retired surfaces must stay unreachable and protected against accidental reintroduction.',
    contracts: [
      {
        kind: 'safe-failure',
        description: 'Retired admin/public feedback routes return 404 for legacy callers.',
        evidence: 'tests/integration/feedback-retirement.test.ts (admin + public 404 route checks)',
        testEvidence: 'tests/integration/feedback-retirement.test.ts',
      },
      {
        kind: 'read-only-enforcement',
        description: 'Guardrail prevents FeedbackWidget module and /api/feedback route reintroduction.',
        evidence: 'docs/rules/automated-rules.md (feedback-module-reintroduction)',
        testEvidence: 'tests/pr-check.test.ts (Rule: feedback-module-reintroduction)',
      },
    ],
  },
];

export function findDeprecationPolicyGaps(entries: DeprecationEntry[] = DEPRECATION_REGISTRY): string[] {
  const gaps: string[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      gaps.push(`${entry.id}: duplicate id`);
    }
    seenIds.add(entry.id);

    if (entry.contracts.length === 0) {
      gaps.push(`${entry.id}: at least one contract is required`);
    }

    if (!entry.replacement || entry.replacement.trim().length === 0) {
      gaps.push(`${entry.id}: replacement guidance is required`);
    }

    for (let index = 0; index < entry.contracts.length; index += 1) {
      const contract = entry.contracts[index];
      const prefix = `${entry.id}: contract[${index}]`;

      if (!contract.description.trim()) {
        gaps.push(`${prefix} missing description`);
      }
      if (!referencePathExists(contract.evidence)) {
        gaps.push(`${prefix} evidence path missing (${contract.evidence})`);
      }
      if (!referencePathExists(contract.testEvidence)) {
        gaps.push(`${prefix} test evidence path missing (${contract.testEvidence})`);
      }
    }

    if (entry.state === 'deprecated' && !hasContract(entry, 'redirect') && !hasContract(entry, 'safe-failure')) {
      gaps.push(`${entry.id}: deprecated entries need redirect or safe-failure contract`);
    }

    if (entry.state === 'hidden' && !hasContract(entry, 'visibility-gate')) {
      gaps.push(`${entry.id}: hidden entries need visibility-gate contract`);
    }

    if (entry.state === 'read-only' && !hasContract(entry, 'read-only-enforcement')) {
      gaps.push(`${entry.id}: read-only entries need read-only-enforcement contract`);
    }

    if (entry.state === 'migrated') {
      if (!hasContract(entry, 'migration')) {
        gaps.push(`${entry.id}: migrated entries need migration contract`);
      }
      if (!hasContract(entry, 'redirect') && !hasContract(entry, 'safe-failure')) {
        gaps.push(`${entry.id}: migrated entries need redirect or safe-failure contract`);
      }
    }

    if (entry.state === 'removed' && !hasContract(entry, 'safe-failure')) {
      gaps.push(`${entry.id}: removed entries need safe-failure contract`);
    }

    if ((entry.state === 'deprecated' || entry.state === 'migrated' || entry.state === 'removed') && !entry.requiresHumanVerification) {
      gaps.push(`${entry.id}: ${entry.state} entries must require human verification`);
    }
  }

  return gaps;
}

export function buildDeprecationLifecycleReport(entries: DeprecationEntry[] = DEPRECATION_REGISTRY): DeprecationLifecycleReport {
  const stateCounts = makeCountMap(DEPRECATION_STATES);
  const contractCounts = makeCountMap(DEPRECATION_CONTRACT_KINDS);

  for (const entry of entries) {
    stateCounts[entry.state] += 1;
    for (const contract of entry.contracts) {
      contractCounts[contract.kind] += 1;
    }
  }

  const missingStates = DEPRECATION_STATES.filter(state => stateCounts[state] === 0);

  return {
    generatedBy: 'scripts/deprecation-lifecycle.ts',
    generatedAt: new Date().toISOString(),
    totalEntries: entries.length,
    humanReviewRequired: entries.filter(entry => entry.requiresHumanVerification).length,
    missingStates,
    policyGaps: findDeprecationPolicyGaps(entries),
    counts: {
      states: stateCounts,
      contracts: contractCounts,
    },
    entries: [...entries].sort((a, b) => a.capability.localeCompare(b.capability)),
  };
}

export function formatDeprecationLifecycleReportMarkdown(
  report: DeprecationLifecycleReport = buildDeprecationLifecycleReport(),
): string {
  const lines: string[] = [];

  lines.push('# Deprecation Lifecycle Report');
  lines.push('');
  lines.push(`Generated by: \`${report.generatedBy}\``);
  lines.push(`Total entries: ${report.totalEntries}`);
  lines.push(`Human verification required: ${report.humanReviewRequired}`);
  lines.push(`Missing lifecycle states: ${report.missingStates.length}`);
  lines.push(`Policy gaps: ${report.policyGaps.length}`);
  lines.push('');

  lines.push('## Lifecycle Counts');
  lines.push('');
  lines.push('| State | Count |');
  lines.push('| --- | ---: |');
  for (const state of DEPRECATION_STATES) {
    lines.push(`| \`${state}\` | ${report.counts.states[state]} |`);
  }
  lines.push('');

  lines.push('## Contract Counts');
  lines.push('');
  lines.push('| Contract | Count |');
  lines.push('| --- | ---: |');
  for (const kind of DEPRECATION_CONTRACT_KINDS) {
    lines.push(`| \`${kind}\` | ${report.counts.contracts[kind]} |`);
  }
  lines.push('');

  lines.push('## Human Verification Queue');
  lines.push('');
  lines.push('| Capability | State | Owner | Notes |');
  lines.push('| --- | --- | --- | --- |');
  for (const entry of report.entries.filter(item => item.requiresHumanVerification)) {
    lines.push(`| ${entry.capability} | \`${entry.state}\` | \`${entry.owner}\` | ${entry.notes} |`);
  }
  lines.push('');

  lines.push('## Registry');
  lines.push('');
  lines.push('| Capability | State | Replacement | Contracts |');
  lines.push('| --- | --- | --- | --- |');
  for (const entry of report.entries) {
    const contracts = entry.contracts.map(contract => `\`${contract.kind}\``).join(', ');
    lines.push(`| ${entry.capability} | \`${entry.state}\` | ${entry.replacement ?? 'n/a'} | ${contracts} |`);
  }
  lines.push('');

  if (report.policyGaps.length > 0) {
    lines.push('## Policy Gaps');
    lines.push('');
    for (const gap of report.policyGaps) {
      lines.push(`- ${gap}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function runCli(): void {
  const report = buildDeprecationLifecycleReport();
  const asJson = process.argv.includes('--json');
  const asMarkdown = process.argv.includes('--markdown');

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (asMarkdown) {
    console.log(formatDeprecationLifecycleReportMarkdown(report));
  } else {
    console.log(`[deprecation-lifecycle] entries=${report.totalEntries} human_review=${report.humanReviewRequired} gaps=${report.policyGaps.length} missing_states=${report.missingStates.length}`);
    for (const state of DEPRECATION_STATES) {
      console.log(`  state:${state}=${report.counts.states[state]}`);
    }
  }

  if (report.missingStates.length > 0 || report.policyGaps.length > 0) {
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl && import.meta.url === entryUrl) {
  runCli();
}
