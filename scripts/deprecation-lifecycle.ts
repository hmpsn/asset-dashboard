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
    state: 'deprecated',
    owner: 'inbox',
    replacement: 'Use /client/:workspaceId/inbox?tab=decisions|conversations|reviews.',
    requiresHumanVerification: true,
    notes: 'Old route aliases remain active only to preserve bookmarks while traffic cool-down is measured.',
    contracts: [
      {
        kind: 'redirect',
        description: 'Legacy aliases are rewritten to Inbox filter deep-links.',
        evidence: 'src/routes.ts (CLIENT_INBOX_ALIASES + clientPath)',
        testEvidence: 'tests/unit/client-routes-redirect.test.tsx (legacy alias redirect assertions)',
      },
    ],
  },
  {
    id: 'client-brand-tab-hidden-without-flag',
    capability: 'Client brand tab visibility is hidden when rollout flag is disabled',
    state: 'hidden',
    owner: 'client-portal',
    replacement: 'Enable brand-tab rollout only when copy-engine contracts are ready.',
    requiresHumanVerification: false,
    notes: 'Feature remains intentionally hidden outside guarded rollout windows.',
    contracts: [
      {
        kind: 'visibility-gate',
        description: 'Brand tab resolves to overview when the brand-section flag is off.',
        evidence: 'src/lib/client-dashboard-tab.ts (brand flag guard branch)',
        testEvidence: 'tests/unit/client-dashboard-tab-routing.test.ts (brand disabled -> overview)',
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
    notes: 'Migration preserved deep-link continuity by routing legacy tab intents into Inbox.',
    contracts: [
      {
        kind: 'migration',
        description: 'Retired schema-review tab now resolves to Inbox routing path.',
        evidence: 'src/lib/client-dashboard-tab.ts (schema-review -> inbox fallback)',
        testEvidence: 'tests/unit/client-dashboard-tab-routing.test.ts (schema-review assertion)',
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
