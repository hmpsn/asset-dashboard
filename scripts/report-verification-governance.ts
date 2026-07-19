#!/usr/bin/env tsx

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERIFICATION_CLASSIFICATIONS = [
  'pr-ci-blocking',
  'push-ci-blocking',
  'local-required',
  'release-check',
  'secret-backed',
  'scenario-probe',
  'manual-advisory',
] as const;

export type VerificationClassification = typeof VERIFICATION_CLASSIFICATIONS[number];

export type VerificationGovernanceEntry = {
  classification: VerificationClassification;
  owner: string;
  rationale: string;
};

export type PackageJsonLike = {
  scripts?: Record<string, string>;
};

export type SourceFile = {
  path: string;
  source: string;
};

export type DeletedReferenceMatch = {
  path: string;
  reference: string;
};

export type VerificationGovernanceReport = {
  generatedBy: 'scripts/report-verification-governance.ts';
  verifyScripts: string[];
  classifiedScripts: string[];
  unclassifiedScripts: string[];
  staleRegistryEntries: string[];
  missingPrCiScripts: string[];
  missingPushCiScripts: string[];
  secretBackedBlockingScripts: string[];
  deletedReferenceMatches: DeletedReferenceMatch[];
  classifications: Record<string, VerificationGovernanceEntry>;
  pass: boolean;
};

export const DELETED_SCRIPT_REFERENCES = [
  'scripts/verify-styleguide-parity.ts',
  'verify-styleguide-parity.ts',
  'scripts/codemods/phase5-buttons.ts',
  'phase5-buttons.ts',
  'scripts/codemods/phase5-forms.ts',
  'phase5-forms.ts',
  'scripts/codemods/phase5-icons.ts',
  'phase5-icons.ts',
  'scripts/codemods/phase5-layout.ts',
  'phase5-layout.ts',
  'scripts/codemods/phase5-overlays.ts',
  'phase5-overlays.ts',
  'scripts/codemods/phase5-typography.ts',
  'phase5-typography.ts',
  'scripts/diagnose-h1.ts',
  'diagnose-h1.ts',
  'scripts/poc-lean-schema.ts',
  'poc-lean-schema.ts',
  'scripts/sync-staging-data.sh',
  'sync-staging-data.sh',
  'scripts/validate-endpoints-precise.js',
  'validate-endpoints-precise.js',
] as const;

export const VERIFICATION_GOVERNANCE_REGISTRY = {
  'verify:organization': {
    classification: 'manual-advisory',
    owner: 'platform-foundation',
    rationale: 'Architecture inventory report for planning and review, not a deterministic PR blocker.',
  },
  'verify:coverage-baseline': {
    classification: 'manual-advisory',
    owner: 'platform-foundation',
    rationale: 'Critical-domain coverage inventory is advisory; the enforced global floor lives in verify:coverage-ratchet.',
  },
  'verify:ai-reliability': {
    classification: 'manual-advisory',
    owner: 'platform-foundation',
    rationale: 'Reliability report is useful review context and runs as a soft gate when needed.',
  },
  'verify:ai-quality': {
    classification: 'manual-advisory',
    owner: 'analytics-intelligence',
    rationale: 'Quality eval report is deterministic-first but still advisory for subjective AI quality signals.',
  },
  'verify:ai-pipeline-wiring': {
    classification: 'manual-advisory',
    owner: 'analytics-intelligence',
    rationale: 'Pipeline wiring inventory informs audits; it is not yet a zero-hit CI contract.',
  },
  'verify:coverage-ratchet': {
    classification: 'release-check',
    owner: 'platform-foundation',
    rationale: 'Enforces the authoritative coverage floor after npm run test:coverage generates a fresh summary during deliberate release verification.',
  },
  'verify:domain-events': {
    classification: 'manual-advisory',
    owner: 'platform-foundation',
    rationale: 'Event-definition inventory is useful for reviews but still includes planning signals.',
  },
  'verify:product-surface': {
    classification: 'manual-advisory',
    owner: 'platform-foundation',
    rationale: 'Product-surface mapping is an audit/report artifact, not a PR-blocking invariant.',
  },
  'verify:data-integrity': {
    classification: 'manual-advisory',
    owner: 'platform-foundation',
    rationale: 'Data recovery/integrity inventory is operator review material.',
  },
  'verify:observability': {
    classification: 'manual-advisory',
    owner: 'platform-foundation',
    rationale: 'Observability inventory is advisory until its checks are narrowed into deterministic contracts.',
  },
  'verify:deferred-ledger': {
    classification: 'pr-ci-blocking',
    owner: 'platform-foundation',
    rationale: 'The UI-rebuild deferred-work ledger (schema, expiry, roadmap links) is cheap, deterministic, and required for every rebuild PR.',
  },
  'verify:feature-flags': {
    classification: 'pr-ci-blocking',
    owner: 'platform-foundation',
    rationale: 'Feature flag catalog consistency is cheap, deterministic, and required for every PR.',
  },
  'verify:env': {
    classification: 'secret-backed',
    owner: 'integrations',
    rationale: 'Environment profile verification inspects provider configuration and is run manually in the target local or staging environment.',
  },
  'verify:lexicon': {
    classification: 'pr-ci-blocking',
    owner: 'platform-foundation',
    rationale: 'Lexicon registry ↔ GLOSSARY.md parity and the duplicate-exported-name allowlist are cheap, deterministic, and required for every PR.',
  },
  'verify:stripe-prices': {
    classification: 'secret-backed',
    owner: 'billing-monetization',
    rationale: 'Requires Stripe configuration/secrets and must remain outside normal PR CI.',
  },
  'verify:model-currency': {
    classification: 'secret-backed',
    owner: 'platform-foundation',
    rationale: 'Requires provider API keys (Anthropic/OpenAI); runs in the nightly workflow and skips gracefully without keys, so it must stay outside normal PR CI.',
  },
  'verify:deprecations': {
    classification: 'release-check',
    owner: 'platform-foundation',
    rationale: 'Deprecation lifecycle review belongs in release readiness and local platform verification.',
  },
  'verify:platform-health-cadence': {
    classification: 'release-check',
    owner: 'platform-foundation',
    rationale: 'Cadence freshness is a release-safety signal rather than a per-PR code invariant.',
  },
  'verify:adr-log': {
    classification: 'release-check',
    owner: 'platform-foundation',
    rationale: 'ADR freshness is checked during platform/release readiness.',
  },
  'verify:risky-modules': {
    classification: 'manual-advisory',
    owner: 'platform-foundation',
    rationale: 'Risky-module inventory is planning guidance and may be run with operator-selected thresholds.',
  },
  'verify:style-drift': {
    classification: 'pr-ci-blocking',
    owner: 'platform-foundation',
    rationale: 'Style drift checks are already cheap deterministic PR quality gates.',
  },
  'verify:bundle-budget': {
    classification: 'pr-ci-blocking',
    owner: 'platform-foundation',
    rationale: 'Frontend JS/CSS/font size ratchet is cheap, deterministic, and runs against the Vite manifest plus built index links emitted by the PR quality build.',
  },
  'verify:coverage-campaign': {
    classification: 'manual-advisory',
    owner: 'platform-foundation',
    rationale: 'Coverage campaign report ranks opportunities for planning and is not a CI gate.',
  },
  'verify:coverage-campaign:strict': {
    classification: 'manual-advisory',
    owner: 'platform-foundation',
    rationale: 'Strict coverage campaign mode is an operator review tool, not normal PR CI.',
  },
  'verify:coverage-campaign:strict:advisory': {
    classification: 'manual-advisory',
    owner: 'platform-foundation',
    rationale: 'Explicitly advisory strict campaign mode remains manual.',
  },
  'verify:staging-merge-integrity': {
    classification: 'pr-ci-blocking',
    owner: 'platform-foundation',
    rationale: 'Staging merge integrity is a deterministic PR quality gate with GitHub token context.',
  },
  'verify:performance-budgets': {
    classification: 'local-required',
    owner: 'platform-foundation',
    rationale: 'Performance budget checks run in local platform verification where timing variance is easier to inspect.',
  },
  'verify:platform': {
    classification: 'local-required',
    owner: 'platform-foundation',
    rationale: 'Aggregates local platform checks and intentionally remains broader than PR CI.',
  },
  'verify:platform:quick': {
    classification: 'local-required',
    owner: 'platform-foundation',
    rationale: 'Fast local platform aggregate for developer machines.',
  },
  'verify:release-safety': {
    classification: 'release-check',
    owner: 'platform-foundation',
    rationale: 'Release readiness audit should run before staging to main promotion.',
  },
  'verify:tenant-boundary': {
    classification: 'release-check',
    owner: 'platform-foundation',
    rationale: 'Tenant-boundary audit is release-safety oriented and can be heavier than PR CI.',
  },
  'verify:the-issue-flag-off': {
    classification: 'scenario-probe',
    owner: 'client-portal',
    rationale: 'DOM probe for a specific scenario; keep manual unless a branch explicitly opts into the scenario.',
  },
  'verify:the-issue-measured-off': {
    classification: 'scenario-probe',
    owner: 'client-portal',
    rationale: 'DOM probe with scenario environment override; not a generic PR gate.',
  },
  'verify:governance': {
    classification: 'pr-ci-blocking',
    owner: 'platform-foundation',
    rationale: 'Keeps verify:* scripts classified and cheap PR blockers wired into CI.',
  },
} satisfies Record<string, VerificationGovernanceEntry>;

const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';
const ROOT = process.cwd();

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractVerifyScripts(packageJson: PackageJsonLike): string[] {
  return Object.keys(packageJson.scripts ?? {})
    .filter(scriptName => scriptName.startsWith('verify:'))
    .sort(compareStrings);
}

function workflowRunsScript(workflowSources: SourceFile[], scriptName: string): boolean {
  const scriptRegex = new RegExp(`npm\\s+run\\s+${escapeRegExp(scriptName)}(?:\\s|$)`);
  return workflowSources.some(file => scriptRegex.test(file.source));
}

function isCiWorkflow(file: SourceFile): boolean {
  return file.path === CI_WORKFLOW_PATH || file.path.endsWith(path.sep + CI_WORKFLOW_PATH);
}

export function buildVerificationGovernanceReport(
  packageJson: PackageJsonLike,
  workflowSources: SourceFile[],
  activeDocSources: SourceFile[],
  registry: Record<string, VerificationGovernanceEntry> = VERIFICATION_GOVERNANCE_REGISTRY,
): VerificationGovernanceReport {
  const verifyScripts = extractVerifyScripts(packageJson);
  const verifyScriptSet = new Set(verifyScripts);
  const registryScripts = Object.keys(registry).sort(compareStrings);
  const ciWorkflowSources = workflowSources.filter(isCiWorkflow);

  const unclassifiedScripts = verifyScripts.filter(scriptName => !registry[scriptName]);
  const staleRegistryEntries = registryScripts.filter(scriptName => !verifyScriptSet.has(scriptName));

  const missingPrCiScripts = registryScripts
    .filter(scriptName => registry[scriptName].classification === 'pr-ci-blocking')
    .filter(scriptName => verifyScriptSet.has(scriptName))
    .filter(scriptName => !workflowRunsScript(ciWorkflowSources, scriptName));

  const missingPushCiScripts = registryScripts
    .filter(scriptName => registry[scriptName].classification === 'push-ci-blocking')
    .filter(scriptName => verifyScriptSet.has(scriptName))
    .filter(scriptName => !workflowRunsScript(ciWorkflowSources, scriptName));

  const secretBackedBlockingScripts = registryScripts
    .filter(scriptName => registry[scriptName].classification === 'secret-backed')
    .filter(scriptName => workflowRunsScript(workflowSources, scriptName));

  const deletedReferenceMatches: DeletedReferenceMatch[] = [];
  for (const file of [...activeDocSources, ...workflowSources]) {
    for (const reference of DELETED_SCRIPT_REFERENCES) {
      if (file.source.includes(reference)) {
        deletedReferenceMatches.push({ path: file.path, reference });
      }
    }
  }

  const pass =
    unclassifiedScripts.length === 0 &&
    staleRegistryEntries.length === 0 &&
    missingPrCiScripts.length === 0 &&
    missingPushCiScripts.length === 0 &&
    secretBackedBlockingScripts.length === 0 &&
    deletedReferenceMatches.length === 0;

  return {
    generatedBy: 'scripts/report-verification-governance.ts',
    verifyScripts,
    classifiedScripts: registryScripts,
    unclassifiedScripts,
    staleRegistryEntries,
    missingPrCiScripts,
    missingPushCiScripts,
    secretBackedBlockingScripts,
    deletedReferenceMatches,
    classifications: registry,
    pass,
  };
}

export function formatVerificationGovernanceReportAsMarkdown(report: VerificationGovernanceReport): string {
  const byClassification = new Map<VerificationClassification, string[]>();
  for (const classification of VERIFICATION_CLASSIFICATIONS) {
    byClassification.set(classification, []);
  }
  for (const scriptName of report.verifyScripts) {
    const entry = report.classifications[scriptName];
    if (entry) {
      byClassification.get(entry.classification)?.push(scriptName);
    }
  }

  const lines = [
    '# Verification Governance Report',
    '',
    `Result: ${report.pass ? 'PASS' : 'FAIL'}`,
    `verify:* scripts in package.json: ${report.verifyScripts.length}`,
    '',
    '| Classification | Scripts |',
    '| --- | --- |',
  ];

  for (const classification of VERIFICATION_CLASSIFICATIONS) {
    const scripts = byClassification.get(classification) ?? [];
    lines.push(`| ${classification} | ${scripts.length > 0 ? scripts.map(scriptName => `\`${scriptName}\``).join(', ') : '_none_'} |`);
  }

  lines.push(
    '',
    `Unclassified verify scripts: ${report.unclassifiedScripts.length}`,
    `Stale registry entries: ${report.staleRegistryEntries.length}`,
    `Missing PR CI scripts: ${report.missingPrCiScripts.length}`,
    `Missing push CI scripts: ${report.missingPushCiScripts.length}`,
    `Secret-backed scripts wired into CI: ${report.secretBackedBlockingScripts.length}`,
    `Deleted-script references in active docs/tooling: ${report.deletedReferenceMatches.length}`,
  );

  const detailSections: Array<[string, string[]]> = [
    ['Unclassified verify scripts', report.unclassifiedScripts],
    ['Stale registry entries', report.staleRegistryEntries],
    ['Missing PR CI scripts', report.missingPrCiScripts],
    ['Missing push CI scripts', report.missingPushCiScripts],
    ['Secret-backed scripts wired into CI', report.secretBackedBlockingScripts],
  ];

  for (const [title, values] of detailSections) {
    if (values.length === 0) continue;
    lines.push('', `## ${title}`);
    for (const value of values) {
      lines.push(`- \`${value}\``);
    }
  }

  if (report.deletedReferenceMatches.length > 0) {
    lines.push('', '## Deleted-Script References');
    for (const match of report.deletedReferenceMatches) {
      lines.push(`- \`${match.path}\` references \`${match.reference}\``);
    }
  }

  return lines.join('\n');
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function readSourceFile(filePath: string): SourceFile {
  return {
    path: path.relative(ROOT, filePath),
    source: readFileSync(filePath, 'utf8'),
  };
}

function walkFiles(rootPath: string, predicate: (filePath: string) => boolean): SourceFile[] {
  if (!existsSync(rootPath)) return [];
  const entries = readdirSync(rootPath);
  const files: SourceFile[] = [];

  for (const entry of entries) {
    const filePath = path.join(rootPath, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...walkFiles(filePath, predicate));
      continue;
    }
    if (stat.isFile() && predicate(filePath)) {
      files.push(readSourceFile(filePath));
    }
  }

  return files;
}

function readWorkflowSources(): SourceFile[] {
  return walkFiles(path.join(ROOT, '.github', 'workflows'), filePath => filePath.endsWith('.yml') || filePath.endsWith('.yaml'));
}

function readActiveDocSources(): SourceFile[] {
  const singleFiles = [
    'CLAUDE.md',
    'AGENTS.md',
    'package.json',
    'vite.config.ts',
    'scripts/pr-check.ts',
  ]
    .map(relativePath => path.join(ROOT, relativePath))
    .filter(existsSync)
    .map(readSourceFile);

  const docsRoots = [
    path.join(ROOT, 'docs', 'rules'),
    path.join(ROOT, 'docs', 'testing'),
    path.join(ROOT, 'docs', 'workflows'),
  ];

  const docFiles = docsRoots.flatMap(rootPath =>
    walkFiles(rootPath, filePath => filePath.endsWith('.md') || filePath.endsWith('.json')),
  );

  return [...singleFiles, ...docFiles];
}

function main(): void {
  const packageJson = readJsonFile<PackageJsonLike>(path.join(ROOT, 'package.json'));
  const report = buildVerificationGovernanceReport(packageJson, readWorkflowSources(), readActiveDocSources());
  console.log(formatVerificationGovernanceReportAsMarkdown(report));

  if (!report.pass) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
