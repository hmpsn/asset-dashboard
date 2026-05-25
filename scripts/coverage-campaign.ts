#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  type ModuleRiskEntry,
  buildRiskyModuleDashboardReport,
} from './platform-risky-module-dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

type CliOptions = {
  top: number;
  sinceDays: number;
  lcovPath: string;
  json: boolean;
  scaffoldPlans: boolean;
  planCount: number;
  includeScripts: boolean;
  strictCheck: boolean;
  strictTop: number;
  advisory: boolean;
};

type LcovFileCoverage = {
  file: string;
  lineFound: number;
  lineHit: number;
  uncoveredLines: number[];
  lineCoveragePct: number;
};

type CampaignItem = {
  module: string;
  owner: string;
  riskScore: number;
  lineCoveragePct: number | null;
  uncoveredLineCount: number;
  hasCoverageData: boolean;
  sampleTests: string[];
  recommendedTestProject: 'component' | 'integration' | 'unit' | 'contract';
  recommendedTargetPath: string;
  priorityScore: number;
};

type CampaignReport = {
  generatedAt: string;
  lcovPath: string;
  riskyTopWindow: number;
  sinceDays: number;
  totalCandidates: number;
  items: CampaignItem[];
};

type QualityAuditEntry = {
  module: string;
  testPath: string;
  exists: boolean;
  testCaseCount: number;
  expectCount: number;
  hasHappyPathSignal: boolean;
  hasFailurePathSignal: boolean;
  requiresSideEffects: boolean;
  hasSideEffectSignal: boolean;
  pass: boolean;
  reasons: string[];
};

type QualityAuditReport = {
  generatedAt: string;
  strictTop: number;
  totalChecked: number;
  passing: number;
  failing: number;
  entries: QualityAuditEntry[];
};

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function parseArgs(argv: string[]): CliOptions | null {
  let top = 200;
  let sinceDays = 180;
  let lcovPath = 'coverage/lcov.info';
  let json = false;
  let scaffoldPlans = false;
  let planCount = 20;
  let includeScripts = false;
  let strictCheck = false;
  let strictTop = 25;
  let advisory = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--scaffold-plans') {
      scaffoldPlans = true;
      continue;
    }
    if (arg === '--include-scripts') {
      includeScripts = true;
      continue;
    }
    if (arg === '--strict-check') {
      strictCheck = true;
      continue;
    }
    if (arg === '--advisory') {
      advisory = true;
      continue;
    }
    if (arg === '--top') {
      const raw = argv[i + 1];
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      top = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (arg === '--since-days') {
      const raw = argv[i + 1];
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      sinceDays = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (arg === '--lcov') {
      const raw = argv[i + 1];
      if (!raw) return null;
      lcovPath = raw;
      i += 1;
      continue;
    }
    if (arg === '--plan-count') {
      const raw = argv[i + 1];
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      planCount = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (arg === '--strict-top') {
      const raw = argv[i + 1];
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      strictTop = Math.floor(parsed);
      i += 1;
      continue;
    }
    return null;
  }

  return {
    top,
    sinceDays,
    lcovPath,
    json,
    scaffoldPlans,
    planCount,
    includeScripts,
    strictCheck,
    strictTop,
    advisory,
  };
}

function printUsage(): void {
  console.error(
    'Usage: tsx scripts/coverage-campaign.ts [--top N] [--since-days N] [--lcov path] [--plan-count N] [--scaffold-plans] [--include-scripts] [--strict-check] [--strict-top N] [--advisory] [--json]',
  );
}

function parseLcov(lcovPath: string): Map<string, LcovFileCoverage> {
  const abs = path.resolve(ROOT, lcovPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Coverage file not found at ${abs}. Run "npm run test:coverage" first.`);
  }

  const content = fs.readFileSync(abs, 'utf8');
  const lines = content.split(/\r?\n/);
  const map = new Map<string, LcovFileCoverage>();

  let currentFile: string | null = null;
  let lineFound = 0;
  let lineHit = 0;
  let uncoveredLines: number[] = [];

  function flush(): void {
    if (!currentFile) return;
    const pct = lineFound > 0 ? (lineHit / lineFound) * 100 : 0;
    map.set(currentFile, {
      file: currentFile,
      lineFound,
      lineHit,
      uncoveredLines: [...uncoveredLines],
      lineCoveragePct: Number(pct.toFixed(2)),
    });
  }

  for (const line of lines) {
    if (line.startsWith('SF:')) {
      flush();
      const sf = line.slice(3).trim();
      currentFile = toPosix(path.relative(ROOT, sf));
      lineFound = 0;
      lineHit = 0;
      uncoveredLines = [];
      continue;
    }

    if (line.startsWith('DA:')) {
      const raw = line.slice(3);
      const [lineNoRaw, hitsRaw] = raw.split(',');
      const lineNo = Number(lineNoRaw);
      const hits = Number(hitsRaw);
      if (Number.isFinite(lineNo) && Number.isFinite(hits)) {
        lineFound += 1;
        if (hits > 0) lineHit += 1;
        else uncoveredLines.push(lineNo);
      }
      continue;
    }

    if (line === 'end_of_record') {
      flush();
      currentFile = null;
      lineFound = 0;
      lineHit = 0;
      uncoveredLines = [];
    }
  }

  flush();
  return map;
}

function isEligibleModule(entry: ModuleRiskEntry, includeScripts: boolean): boolean {
  if (!includeScripts && entry.module.startsWith('scripts/')) return false;
  if (entry.module.includes('/__tests__/')) return false;
  if (/\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(entry.module)) return false;
  return true;
}

function recommendedTarget(modulePath: string): { project: CampaignItem['recommendedTestProject']; targetPath: string } {
  const noExt = modulePath.replace(/\.[^.]+$/, '');
  const base = path.basename(noExt);
  const dir = path.dirname(noExt);

  if (modulePath.startsWith('src/components/') && modulePath.endsWith('.tsx')) {
    const sub = dir.replace(/^src\/components\/?/, '');
    const rel = sub ? path.join('tests/component', sub, `${base}.test.tsx`) : path.join('tests/component', `${base}.test.tsx`);
    return { project: 'component', targetPath: toPosix(rel) };
  }

  if (modulePath.startsWith('server/routes/')) {
    return { project: 'integration', targetPath: toPosix(path.join('tests/integration', `${base}.test.ts`)) };
  }

  if (modulePath.startsWith('shared/types/')) {
    return { project: 'contract', targetPath: toPosix(path.join('tests/contract', `${base}.test.ts`)) };
  }

  const relDir = dir.replace(/^(src|server|shared|scripts)\//, '');
  return { project: 'unit', targetPath: toPosix(path.join('tests/unit', relDir, `${base}.test.ts`)) };
}

function buildCampaignReport(options: CliOptions): CampaignReport {
  const risky = buildRiskyModuleDashboardReport({
    projectRoot: ROOT,
    topN: options.top,
    sinceDays: options.sinceDays,
  });
  const lcov = parseLcov(options.lcovPath);

  const items: CampaignItem[] = risky.topRiskModules
    .filter(entry => isEligibleModule(entry, options.includeScripts))
    .map(entry => {
      const coverage = lcov.get(entry.module);
      const lineCoveragePct = coverage ? coverage.lineCoveragePct : null;
      const uncoveredLineCount = coverage ? coverage.uncoveredLines.length : Math.max(1, Math.round(entry.lineCount * 0.7));
      const uncoveredRatio = lineCoveragePct === null ? 1 : Math.max(0, (100 - lineCoveragePct) / 100);
      const priorityScore = Number((entry.score * (0.55 + uncoveredRatio)).toFixed(2));
      const recommended = recommendedTarget(entry.module);

      return {
        module: entry.module,
        owner: entry.owner,
        riskScore: entry.score,
        lineCoveragePct,
        uncoveredLineCount,
        hasCoverageData: Boolean(coverage),
        sampleTests: entry.sampleTests,
        recommendedTestProject: recommended.project,
        recommendedTargetPath: recommended.targetPath,
        priorityScore,
      };
    })
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      if (b.uncoveredLineCount !== a.uncoveredLineCount) return b.uncoveredLineCount - a.uncoveredLineCount;
      return b.riskScore - a.riskScore;
    });

  return {
    generatedAt: new Date().toISOString(),
    lcovPath: path.resolve(ROOT, options.lcovPath),
    riskyTopWindow: options.top,
    sinceDays: options.sinceDays,
    totalCandidates: items.length,
    items,
  };
}

function formatCoverage(value: number | null): string {
  if (value === null) return 'n/a';
  return `${value.toFixed(2)}%`;
}

function formatReportMarkdown(report: CampaignReport): string {
  const out: string[] = [];
  out.push('# Coverage Campaign Backlog');
  out.push('');
  out.push(`- Generated at: ${report.generatedAt}`);
  out.push(`- Risk window: top ${report.riskyTopWindow}, since ${report.sinceDays} days`);
  out.push(`- LCOV source: \`${report.lcovPath}\``);
  out.push(`- Candidate modules: ${report.totalCandidates}`);
  out.push('');
  out.push('| Rank | Module | Priority | Risk | Line Coverage | Uncovered Lines | Project | Suggested Test Path |');
  out.push('| --- | --- | ---: | ---: | ---: | ---: | --- | --- |');

  report.items.slice(0, 50).forEach((item, index) => {
    out.push(
      `| ${index + 1} | \`${item.module}\` | ${item.priorityScore.toFixed(2)} | ${item.riskScore.toFixed(2)} | ${formatCoverage(item.lineCoveragePct)} | ${item.uncoveredLineCount} | ${item.recommendedTestProject} | \`${item.recommendedTargetPath}\` |`,
    );
  });

  out.push('');
  out.push('## Quality Rules For Correct Tests');
  out.push('- Include at least one happy-path assertion on user-visible or contract-visible behavior.');
  out.push('- Include at least one failure/edge-path assertion (invalid input, provider error, empty state, or denied access).');
  out.push('- Assert outcomes, not implementation details (avoid testing internal state that users never observe).');
  out.push('- For routes/mutations: assert both response shape and persistence/broadcast side-effects when applicable.');
  out.push('');
  return `${out.join('\n')}\n`;
}

function planPathFor(modulePath: string): string {
  const slug = modulePath.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9/]+/g, '-');
  const rel = path.join('tests', 'campaign-plans', `${slug}.campaign.md`);
  return toPosix(rel);
}

function renderPlan(item: CampaignItem): string {
  return [
    `# Test Campaign Plan: ${item.module}`,
    '',
    `- Priority score: ${item.priorityScore.toFixed(2)}`,
    `- Risk score: ${item.riskScore.toFixed(2)}`,
    `- Current line coverage: ${formatCoverage(item.lineCoveragePct)}`,
    `- Uncovered lines: ${item.uncoveredLineCount}`,
    `- Suggested project: ${item.recommendedTestProject}`,
    `- Suggested target test path: \`${item.recommendedTargetPath}\``,
    '',
    '## Existing Signals',
    ...(item.sampleTests.length > 0 ? item.sampleTests.map(test => `- \`${test}\``) : ['- none discovered by risky-module linkage']),
    '',
    '## Required Assertions (Correctness Gate)',
    '- Happy path: assert one concrete output/behavior contract.',
    '- Failure path: assert one concrete error/edge contract.',
    '- Side effects: assert data persistence, cache invalidation, or emitted events when applicable.',
    '- Vocabulary/contracts: verify canonical labels and typed boundaries where relevant.',
    '',
    '## Notes',
    '- This plan file is intentionally non-runnable. Promote it to a real `*.test.ts`/`*.test.tsx` only after concrete assertions are written.',
    '',
  ].join('\n');
}

function scaffoldPlans(report: CampaignReport, planCount: number): string[] {
  const created: string[] = [];
  const limit = Math.min(planCount, report.items.length);

  for (let i = 0; i < limit; i += 1) {
    const item = report.items[i];
    const rel = planPathFor(item.module);
    const abs = path.resolve(ROOT, rel);
    if (fs.existsSync(abs)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, renderPlan(item), 'utf8');
    created.push(rel);
  }

  return created;
}

function collectTestTitles(source: string): string[] {
  const titles: string[] = [];
  const re = /\b(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match: RegExpExecArray | null;
  do {
    match = re.exec(source);
    if (match?.[1]) titles.push(match[1].trim());
  } while (match);
  return titles;
}

function countTestCases(source: string): number {
  const total = (source.match(/\b(?:it|test)\s*\(/g) ?? []).length;
  const todo = (source.match(/\b(?:it|test)\.todo\s*\(/g) ?? []).length;
  return Math.max(0, total - todo);
}

function requiresSideEffectsForModule(modulePath: string): boolean {
  if (modulePath.startsWith('server/routes/')) return true;
  if (modulePath.includes('/mutation')) return true;
  return false;
}

function buildQualityAudit(report: CampaignReport, strictTop: number): QualityAuditReport {
  const entries: QualityAuditEntry[] = [];
  const candidates = report.items.slice(0, strictTop);

  const failureSignals = /\b(error|fail|invalid|forbidden|unauthorized|denied|reject|throw|not found|empty)\b/i;
  const sideEffectSignals = /\b(broadcastToWorkspace|addActivity|invalidateQueries|setQueryData|toHaveBeenCalled(?:With)?|status\s*:\s*(?:4\d\d|5\d\d)|toMatchObject|toEqual)\b/;

  function evaluateSource(modulePath: string, source: string): Omit<QualityAuditEntry, 'module' | 'testPath' | 'exists'> {
    const reasons: string[] = [];
    const titles = collectTestTitles(source);
    const testCaseCount = countTestCases(source);
    const expectCount = (source.match(/\bexpect\s*\(/g) ?? []).length;
    const hasFailureTitle = titles.some(title => failureSignals.test(title));
    const hasFailureMatcher = /\b(rejects|toThrow|toThrowError)\b/.test(source);
    const hasFailurePathSignal = hasFailureTitle || hasFailureMatcher;
    const hasHappyPathSignal = titles.some(title => !failureSignals.test(title));
    const requiresSideEffects = requiresSideEffectsForModule(modulePath);
    const hasSideEffectSignal = sideEffectSignals.test(source);

    if (testCaseCount < 2) reasons.push('needs at least 2 non-todo test cases');
    if (expectCount < 2) reasons.push('needs at least 2 assertions');
    if (!hasHappyPathSignal) reasons.push('missing happy-path test signal');
    if (!hasFailurePathSignal) reasons.push('missing failure/edge-path test signal');
    if (requiresSideEffects && !hasSideEffectSignal) reasons.push('missing side-effect assertion signal');

    return {
      testCaseCount,
      expectCount,
      hasHappyPathSignal,
      hasFailurePathSignal,
      requiresSideEffects,
      hasSideEffectSignal,
      pass: reasons.length === 0,
      reasons,
    };
  }

  for (const item of candidates) {
    const candidatePaths = [...new Set([item.recommendedTargetPath, ...item.sampleTests])];
    const existingCandidates = candidatePaths.filter(candidate => fs.existsSync(path.resolve(ROOT, candidate)));

    if (existingCandidates.length === 0) {
      entries.push({
        module: item.module,
        testPath: item.recommendedTargetPath,
        exists: false,
        testCaseCount: 0,
        expectCount: 0,
        hasHappyPathSignal: false,
        hasFailurePathSignal: false,
        requiresSideEffects: requiresSideEffectsForModule(item.module),
        hasSideEffectSignal: false,
        pass: false,
        reasons: ['missing test file'],
      });
      continue;
    }

    let bestPath = existingCandidates[0];
    let bestEval = evaluateSource(item.module, fs.readFileSync(path.resolve(ROOT, bestPath), 'utf8'));

    for (const candidate of existingCandidates.slice(1)) {
      const nextEval = evaluateSource(item.module, fs.readFileSync(path.resolve(ROOT, candidate), 'utf8'));
      const nextScore = nextEval.reasons.length * 1000 - nextEval.expectCount - nextEval.testCaseCount;
      const bestScore = bestEval.reasons.length * 1000 - bestEval.expectCount - bestEval.testCaseCount;
      if (nextScore < bestScore) {
        bestEval = nextEval;
        bestPath = candidate;
      }
    }

    entries.push({
      module: item.module,
      testPath: bestPath,
      exists: true,
      ...bestEval,
    });
  }

  const passing = entries.filter(entry => entry.pass).length;
  return {
    generatedAt: new Date().toISOString(),
    strictTop,
    totalChecked: entries.length,
    passing,
    failing: entries.length - passing,
    entries,
  };
}

function formatQualityAuditMarkdown(audit: QualityAuditReport): string {
  const out: string[] = [];
  out.push('## Strict Quality Audit');
  out.push('');
  out.push(`- Checked modules: ${audit.totalChecked}`);
  out.push(`- Passing: ${audit.passing}`);
  out.push(`- Failing: ${audit.failing}`);
  out.push('');

  if (audit.failing === 0) {
    out.push('All audited modules passed strict quality gates.');
    out.push('');
    return out.join('\n');
  }

  out.push('| Module | Test Path | Problems |');
  out.push('| --- | --- | --- |');
  for (const entry of audit.entries.filter(item => !item.pass)) {
    out.push(`| \`${entry.module}\` | \`${entry.testPath}\` | ${entry.reasons.join('; ')} |`);
  }
  out.push('');
  return out.join('\n');
}

function runCli(): number {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    printUsage();
    return 1;
  }

  const report = buildCampaignReport(args);
  const createdPlans = args.scaffoldPlans ? scaffoldPlans(report, args.planCount) : [];
  const audit = args.strictCheck ? buildQualityAudit(report, args.strictTop) : null;

  if (args.json) {
    console.log(JSON.stringify({ ...report, createdPlans, qualityAudit: audit }, null, 2));
  } else {
    console.log(formatReportMarkdown(report));
    if (args.scaffoldPlans) {
      console.log(`Scaffolded campaign plans: ${createdPlans.length}`);
      for (const rel of createdPlans) {
        console.log(`- ${rel}`);
      }
    }
    if (audit) {
      console.log(formatQualityAuditMarkdown(audit));
    }
  }

  if (audit && audit.failing > 0 && !args.advisory) {
    return 1;
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runCli());
}
