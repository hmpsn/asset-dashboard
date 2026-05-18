#!/usr/bin/env tsx

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path, { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type AuditStatus = 'pass' | 'warn' | 'fail';

export type TenantBoundaryAuditFinding = {
  id: string;
  title: string;
  status: AuditStatus;
  details: string[];
};

export type TenantBoundaryAuditReport = {
  generatedBy: 'scripts/platform-tenant-boundary-audit.ts';
  generatedAt: string;
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  findings: TenantBoundaryAuditFinding[];
};

export type AuditSourceFile = {
  path: string;
  source: string;
};

type ForeignIdTestSpec = {
  path: string;
  pattern: RegExp;
  description: string;
};

export type TenantBoundaryAuditInputs = {
  routeFiles: AuditSourceFile[];
  appSource: string;
  testFiles: AuditSourceFile[];
  clientUsersSource: string;
  publicPortalSource: string;
};

type WorkspaceGuardEvaluation = {
  scopedRoutes: number;
  unguardedAdminFiles: string[];
  unguardedPublicFiles: string[];
  appLevelPublicGuardDetected: boolean;
};

type UploadGuardEvaluation = {
  uploadRouteCount: number;
  unguardedUploadRoutes: string[];
};

type WebhookEvaluation = {
  hasRawBodyRoute: boolean;
  checksStripeSignatureHeader: boolean;
  verifiesEventSignature: boolean;
  dispatchesVerifiedEvent: boolean;
};

type ForeignIdCoverageEvaluation = {
  total: number;
  missingFiles: string[];
  missingPatterns: string[];
};

type ClientUsersGuardEvaluation = {
  missingSignatures: string[];
  missingWorkspaceAssertions: string[];
};

type RouteCall = {
  path: string;
  statement: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ROUTES_DIR = join(ROOT, 'server/routes');
const APP_PATH = join(ROOT, 'server/app.ts');
const CLIENT_USERS_PATH = join(ROOT, 'server/client-users.ts');
const PUBLIC_PORTAL_PATH = join(ROOT, 'server/routes/public-portal.ts');
const TESTS_INTEGRATION_DIR = join(ROOT, 'tests/integration');

const WORKSPACE_GUARD_TOKENS = [
  'requireWorkspaceAccess(',
  'requireWorkspaceSiteAccess(',
  'requireWorkspaceSiteAccessFromQuery(',
  'requireWorkspaceSiteAccessFromBody(',
  'requireClientPortalAuth(',
  'requestUserCanAccessWorkspace(',
  'canAccessRequest(',
];

const FOREIGN_ID_TEST_SPECS: ForeignIdTestSpec[] = [
  {
    path: 'tests/integration/wave2b-route-contracts.test.ts',
    pattern: /workspace A admin route to mutate a workspace B client user by id|cross-workspace/i,
    description: 'Wave 2b route contracts include known foreign-id guard regression coverage.',
  },
  {
    path: 'tests/integration/workspace-access-control.test.ts',
    pattern: /cross-workspace|forbidden|403|404/i,
    description: 'Workspace access control tests cover cross-workspace rejection behavior.',
  },
  {
    path: 'tests/integration/content-request-mutation-safety.test.ts',
    pattern: /cross-workspace/i,
    description: 'Content-request mutation safety includes cross-workspace mutation rejection.',
  },
  {
    path: 'tests/integration/schema-mutation-safety.test.ts',
    pattern: /cross-workspace/i,
    description: 'Schema mutation safety includes cross-workspace mutation rejection.',
  },
  {
    path: 'tests/integration/public-analytics.test.ts',
    pattern: /cross-workspace isolation|workspace B response does not contain/i,
    description: 'Public analytics tests verify workspace isolation in public serialization.',
  },
];

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) results.push(fullPath);
  }
  return results.sort((a, b) => a.localeCompare(b));
}

function loadAuditSourceFilesFromDir(dir: string): AuditSourceFile[] {
  return collectTsFiles(dir).map(filePath => ({
    path: relative(ROOT, filePath),
    source: readFileSync(filePath, 'utf8'),
  }));
}

function findClosingParenIndex(source: string, openParenIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i];
    const prev = i > 0 ? source[i - 1] : '';

    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '(') {
      depth += 1;
      continue;
    }

    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractRouteCalls(source: string): RouteCall[] {
  const routeCalls: RouteCall[] = [];
  const routeOpenPattern = /router\.(?:get|post|put|patch|delete|use)\(\s*(['"`])([^'"`]+)\1/g;

  let match: RegExpExecArray | null;
  while ((match = routeOpenPattern.exec(source)) !== null) {
    const pathLiteral = match[2] ?? '';
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex < 0) continue;
    const closeParenIndex = findClosingParenIndex(source, openParenIndex);
    if (closeParenIndex < 0) continue;
    routeCalls.push({
      path: pathLiteral,
      statement: source.slice(match.index, closeParenIndex + 1),
    });
  }

  return routeCalls;
}

export function loadTenantBoundaryAuditInputsFromDisk(): TenantBoundaryAuditInputs {
  return {
    routeFiles: loadAuditSourceFilesFromDir(ROUTES_DIR),
    appSource: readFileSync(APP_PATH, 'utf8'),
    testFiles: loadAuditSourceFilesFromDir(TESTS_INTEGRATION_DIR),
    clientUsersSource: readFileSync(CLIENT_USERS_PATH, 'utf8'),
    publicPortalSource: existsSync(PUBLIC_PORTAL_PATH) ? readFileSync(PUBLIC_PORTAL_PATH, 'utf8') : '',
  };
}

function hasAppLevelPublicGuard(appSource: string): boolean {
  return appSource.includes("if (!req.path.startsWith('/api/public/')) return next();")
    && appSource.includes('verifyClientSession(')
    && appSource.includes('verifyClientUserTokenForWorkspace(');
}

function evaluateWorkspaceGuardCoverage(routeFiles: AuditSourceFile[], appSource: string): WorkspaceGuardEvaluation {
  const unguardedAdminFiles: string[] = [];
  const unguardedPublicFiles: string[] = [];
  let scopedRouteCount = 0;
  const appLevelPublicGuardDetected = hasAppLevelPublicGuard(appSource);

  for (const file of routeFiles) {
    const routeCalls = extractRouteCalls(file.source);
    const publicGuardedPrefixes = routeCalls
      .filter(call => call.path.startsWith('/api/public/') && call.statement.includes('requireClientPortalAuth('))
      .map(call => call.path);

    for (const call of routeCalls) {
      if (!call.path.startsWith('/api/')) continue;
      if (!/:workspaceId|:siteId/.test(call.path)) continue;
      scopedRouteCount += 1;

      const hasGuard = WORKSPACE_GUARD_TOKENS.some(token => call.statement.includes(token));
      if (hasGuard) continue;
      if (call.statement.includes('tenant-boundary-audit-ok')) continue;

      const inheritsPublicGuard = publicGuardedPrefixes.some(prefix => call.path.startsWith(prefix));
      if (inheritsPublicGuard) continue;

      const ref = `${file.path} (${call.path})`;
      if (call.path.startsWith('/api/public/')) {
        if (!appLevelPublicGuardDetected) unguardedPublicFiles.push(ref);
      }
      else unguardedAdminFiles.push(ref);
    }
  }

  return {
    scopedRoutes: scopedRouteCount,
    unguardedAdminFiles: [...unguardedAdminFiles].sort((a, b) => a.localeCompare(b)),
    unguardedPublicFiles: [...unguardedPublicFiles].sort((a, b) => a.localeCompare(b)),
    appLevelPublicGuardDetected,
  };
}

function evaluateUploadGuardCoverage(routeFiles: AuditSourceFile[]): UploadGuardEvaluation {
  const unguardedUploadRoutes: string[] = [];
  let uploadRouteCount = 0;

  for (const file of routeFiles) {
    const routeCalls = extractRouteCalls(file.source);
    const publicGuardedPrefixes = routeCalls
      .filter(call => call.path.startsWith('/api/public/') && call.statement.includes('requireClientPortalAuth('))
      .map(call => call.path);

    for (const call of routeCalls) {
      if (!/upload\.(?:array|single)\(/.test(call.statement)) continue;
      uploadRouteCount += 1;

      const hasGuard = WORKSPACE_GUARD_TOKENS.some(token => call.statement.includes(token));
      if (hasGuard) continue;
      if (call.statement.includes('tenant-boundary-audit-ok')) continue;

      const inheritsPublicGuard = publicGuardedPrefixes.some(prefix => call.path.startsWith(prefix));
      if (inheritsPublicGuard) continue;

      unguardedUploadRoutes.push(`${file.path} (${call.path})`);
    }
  }

  return {
    uploadRouteCount,
    unguardedUploadRoutes: [...unguardedUploadRoutes].sort((a, b) => a.localeCompare(b)),
  };
}

function evaluateStripeWebhookTrustBoundary(appSource: string): WebhookEvaluation {
  return {
    hasRawBodyRoute: /app\.post\(\s*['"`]\/api\/stripe\/webhook['"`]\s*,\s*express\.raw\(\{\s*type:\s*['"`]application\/json['"`]\s*\}\)/s.test(appSource),
    checksStripeSignatureHeader: /stripe-signature/.test(appSource) && /Missing stripe-signature header/.test(appSource),
    verifiesEventSignature: /constructWebhookEvent\(req\.body,\s*sig\)/.test(appSource),
    dispatchesVerifiedEvent: /handleWebhookEvent\(event\)/.test(appSource),
  };
}

function evaluatePublicSerialization(publicPortalSource: string): { spreadJsonCalls: number } {
  if (!publicPortalSource) return { spreadJsonCalls: 0 };
  const spreadJsonCalls = (publicPortalSource.match(/res\.json\(\s*\{[\s\S]{0,250}\.\.\./g) ?? []).length;
  return { spreadJsonCalls };
}

function evaluateForeignIdTestCoverage(testFiles: AuditSourceFile[]): ForeignIdCoverageEvaluation {
  const byPath = new Map<string, string>(testFiles.map(file => [file.path, file.source]));
  const missingFiles: string[] = [];
  const missingPatterns: string[] = [];

  for (const spec of FOREIGN_ID_TEST_SPECS) {
    const source = byPath.get(spec.path);
    if (!source) {
      missingFiles.push(`${spec.path} (${spec.description})`);
      continue;
    }
    if (!spec.pattern.test(source)) {
      missingPatterns.push(`${spec.path} (${spec.description})`);
    }
  }

  return {
    total: FOREIGN_ID_TEST_SPECS.length,
    missingFiles,
    missingPatterns,
  };
}

function evaluateClientUsersWorkspaceGuard(clientUsersSource: string): ClientUsersGuardEvaluation {
  const functions = ['updateClientUser', 'changeClientPassword', 'deleteClientUser'];
  const missingSignatures: string[] = [];
  const missingWorkspaceAssertions: string[] = [];

  for (const fnName of functions) {
    const signaturePattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${fnName}\\s*\\([^)]*expectedWorkspaceId:\\s*string`, 's');
    if (!signaturePattern.test(clientUsersSource)) {
      missingSignatures.push(fnName);
    }
  }

  const assertionCalls = (clientUsersSource.match(/assertUserInWorkspace\([^)]*expectedWorkspaceId\)/g) ?? []).length;
  if (assertionCalls < functions.length) {
    missingWorkspaceAssertions.push(
      `Expected at least ${functions.length} assertUserInWorkspace(..., expectedWorkspaceId) calls, found ${assertionCalls}.`,
    );
  }

  return {
    missingSignatures,
    missingWorkspaceAssertions,
  };
}

export function buildTenantBoundaryAuditReport(inputs: TenantBoundaryAuditInputs): TenantBoundaryAuditReport {
  const workspaceGuards = evaluateWorkspaceGuardCoverage(inputs.routeFiles, inputs.appSource);
  const uploadGuards = evaluateUploadGuardCoverage(inputs.routeFiles);
  const webhook = evaluateStripeWebhookTrustBoundary(inputs.appSource);
  const publicSerialization = evaluatePublicSerialization(inputs.publicPortalSource);
  const foreignIdCoverage = evaluateForeignIdTestCoverage(inputs.testFiles);
  const clientUsersGuards = evaluateClientUsersWorkspaceGuard(inputs.clientUsersSource);

  const findings: TenantBoundaryAuditFinding[] = [];
  const capDetails = (items: string[], format: (value: string) => string, limit: number = 20): string[] => {
    const rendered = items.slice(0, limit).map(format);
    if (items.length > limit) rendered.push(`... and ${items.length - limit} more`);
    return rendered;
  };

  findings.push({
    id: 'workspace-route-guards',
    title: 'Workspace-scoped route guard coverage',
    status: workspaceGuards.unguardedAdminFiles.length > 0 ? 'fail' : workspaceGuards.unguardedPublicFiles.length > 0 ? 'warn' : 'pass',
    details: [
      `Scoped routes scanned: ${workspaceGuards.scopedRoutes}.`,
      `Unguarded admin routes: ${workspaceGuards.unguardedAdminFiles.length}.`,
      `Unguarded public routes: ${workspaceGuards.unguardedPublicFiles.length}.`,
      ...(workspaceGuards.appLevelPublicGuardDetected
        ? ['App-level public auth/session guard detected in server/app.ts; public route-level guard warnings suppressed.']
        : []),
      ...capDetails(
        workspaceGuards.unguardedAdminFiles,
        file => `Missing explicit workspace guard in admin route file: ${file}`,
      ),
      ...capDetails(
        workspaceGuards.unguardedPublicFiles,
        file => `Public route file has workspace-param paths without route-level guard (verify app-level middleware intent): ${file}`,
      ),
    ],
  });

  findings.push({
    id: 'upload-route-guards',
    title: 'File upload route protection',
    status: uploadGuards.unguardedUploadRoutes.length > 0 ? 'fail' : 'pass',
    details: [
      `Upload routes detected: ${uploadGuards.uploadRouteCount}.`,
      `Unguarded upload route references: ${uploadGuards.unguardedUploadRoutes.length}.`,
      ...capDetails(uploadGuards.unguardedUploadRoutes, ref => `Upload route may be missing workspace/client guard: ${ref}`),
    ],
  });

  const webhookFailures = [
    !webhook.hasRawBodyRoute ? 'Stripe webhook route missing express.raw(application/json) boundary.' : null,
    !webhook.checksStripeSignatureHeader ? 'Stripe webhook route missing stripe-signature header validation.' : null,
    !webhook.verifiesEventSignature ? 'Stripe webhook route missing constructWebhookEvent(req.body, sig) verification.' : null,
    !webhook.dispatchesVerifiedEvent ? 'Stripe webhook route missing verified-event dispatch.' : null,
  ].filter(Boolean) as string[];

  findings.push({
    id: 'stripe-webhook-trust-boundary',
    title: 'Billing webhook trust boundary',
    status: webhookFailures.length > 0 ? 'fail' : 'pass',
    details: webhookFailures.length > 0 ? webhookFailures : ['Stripe webhook raw-body + signature-verification flow is present in server/app.ts.'],
  });

  findings.push({
    id: 'public-serialization-hygiene',
    title: 'Public serialization hygiene',
    status: publicSerialization.spreadJsonCalls > 0 ? 'warn' : 'pass',
    details: publicSerialization.spreadJsonCalls > 0
      ? [`Detected ${publicSerialization.spreadJsonCalls} res.json object spread usage(s) in public-portal route; verify field allow-listing.`]
      : ['No risky object-spread serialization patterns detected in public-portal response objects.'],
  });

  const foreignFailures = [...foreignIdCoverage.missingFiles, ...foreignIdCoverage.missingPatterns];
  findings.push({
    id: 'foreign-id-regression-tests',
    title: 'Known foreign-ID regression coverage',
    status: foreignFailures.length > 0 ? 'fail' : 'pass',
    details: [
      `Required regression specs checked: ${foreignIdCoverage.total}.`,
      ...foreignIdCoverage.missingFiles.map(line => `Missing file: ${line}`),
      ...foreignIdCoverage.missingPatterns.map(line => `Coverage pattern not found: ${line}`),
      ...(foreignFailures.length === 0 ? ['All required foreign-ID regression test surfaces are present.'] : []),
    ],
  });

  const clientUserFailures = [...clientUsersGuards.missingSignatures, ...clientUsersGuards.missingWorkspaceAssertions];
  findings.push({
    id: 'client-user-mutation-guards',
    title: 'Client-user mutation workspace assertions',
    status: clientUserFailures.length > 0 ? 'fail' : 'pass',
    details: [
      ...clientUsersGuards.missingSignatures.map(name => `${name} is missing required expectedWorkspaceId: string parameter.`),
      ...clientUsersGuards.missingWorkspaceAssertions,
      ...(clientUserFailures.length === 0
        ? ['Client-user mutation exports include expectedWorkspaceId signatures and assertion call coverage.']
        : []),
    ],
  });

  const summary = findings.reduce(
    (acc, finding) => {
      acc[finding.status] += 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 },
  );

  return {
    generatedBy: 'scripts/platform-tenant-boundary-audit.ts',
    generatedAt: new Date().toISOString(),
    summary,
    findings,
  };
}

export function formatTenantBoundaryAuditReportMarkdown(report: TenantBoundaryAuditReport): string {
  const lines: string[] = [];
  lines.push('# Tenant Boundary Audit Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Findings: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`);
  lines.push('');

  for (const finding of report.findings) {
    const status = finding.status.toUpperCase();
    lines.push(`## [${status}] ${finding.title}`);
    for (const detail of finding.details) {
      lines.push(`- ${detail}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function printUsage(): void {
  console.error('Usage: npm run verify:tenant-boundary -- [--json]');
}

export function runTenantBoundaryAuditCli(args: string[]): number {
  const json = args.includes('--json');
  const help = args.includes('--help') || args.includes('-h');
  if (help) {
    printUsage();
    return 0;
  }

  const report = buildTenantBoundaryAuditReport(loadTenantBoundaryAuditInputsFromDisk());
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatTenantBoundaryAuditReportMarkdown(report));

  return report.summary.fail > 0 ? 1 : 0;
}

function runCli(): void {
  process.exit(runTenantBoundaryAuditCli(process.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
