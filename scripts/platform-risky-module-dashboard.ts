#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CHECKS, checkDirectory, checkFile } from './pr-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const INFRA_DIRS = new Set([
  '.git',
  '.worktrees',
  '.claude',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'reports',
  'test-results',
]);

const MODULE_ROOTS = ['server', 'src', 'shared', 'scripts'] as const;
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs'] as const;

type ModuleRoot = typeof MODULE_ROOTS[number];

type RiskScoreBreakdown = {
  size: number;
  churn: number;
  graph: number;
  markers: number;
  tests: number;
  routeWrites: number;
  warnings: number;
};

export interface ModuleRiskEntry {
  module: string;
  owner: ModuleRoot;
  lineCount: number;
  churnTouches: number;
  fanIn: number;
  fanOut: number;
  todoCount: number;
  hatchCommentCount: number;
  hasTestReference: boolean;
  routeWriteHandlers: number;
  routeWriteWithoutIntegrationTest: boolean;
  prCheckWarningHits: number;
  score: number;
  scoreBreakdown: RiskScoreBreakdown;
  sampleTests: string[];
}

export interface RiskyModuleDashboardReport {
  generatedAt: string;
  projectRoot: string;
  sinceDays: number;
  moduleCount: number;
  topN: number;
  metrics: {
    modulesWithoutTests: number;
    routeFilesWithoutIntegrationCoverage: number;
    warningHitFiles: number;
  };
  topRiskModules: ModuleRiskEntry[];
}

export interface RiskyModuleOptions {
  projectRoot?: string;
  sinceDays?: number;
  topN?: number;
}

type PrCheck = {
  severity?: 'warn' | 'error';
  pathFilter?: string;
  fileGlobs?: string[];
  exclude?: string | string[];
  customCheck?: ((files: string[]) => Array<{ file: string; line: number; text: string }>) | undefined;
};

type CliOptions = {
  json: boolean;
  topN: number;
  sinceDays: number;
  help: boolean;
};

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function isUnderInfraDir(relativePath: string): boolean {
  const parts = toPosix(relativePath).split('/');
  return parts.some(part => INFRA_DIRS.has(part));
}

function hasModuleExtension(filePath: string): boolean {
  return MODULE_EXTENSIONS.some(ext => filePath.endsWith(ext));
}

function isModuleFile(relativePath: string): boolean {
  const normalized = toPosix(relativePath);
  if (isUnderInfraDir(normalized)) return false;
  if (normalized.startsWith('tests/')) return false;
  if (normalized.startsWith('server/db/migrations/')) return false;
  if (!hasModuleExtension(normalized)) return false;
  return MODULE_ROOTS.some(root => normalized === root || normalized.startsWith(`${root}/`));
}

function walkRepoFiles(projectRoot: string): string[] {
  const out: string[] = [];

  function walk(current: string): void {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (INFRA_DIRS.has(entry.name)) continue;
      const abs = path.join(current, entry.name);
      const rel = toPosix(path.relative(projectRoot, abs));
      if (entry.isDirectory()) {
        walk(abs);
      } else {
        out.push(rel);
      }
    }
  }

  walk(projectRoot);
  return out.sort((a, b) => a.localeCompare(b));
}

export function countRouteWriteHandlers(source: string): number {
  const matches = source.match(/\b(?:router|app)\s*\.\s*(?:post|put|patch|delete)\s*\(/g);
  return matches ? matches.length : 0;
}

export function countRiskMarkers(source: string): { todoCount: number; hatchCommentCount: number } {
  const todoCount = (source.match(/\b(?:TODO|FIXME|HACK)\b/gi) ?? []).length;
  const hatchCommentCount = (source.match(/\b[a-z0-9-]+-ok\b/gi) ?? []).length;
  return { todoCount, hatchCommentCount };
}

export function extractImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();

  const importExportRegex = /\b(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?['"`]([^'"`]+)['"`]/g;
  const dynamicImportRegex = /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

  for (const regex of [importExportRegex, dynamicImportRegex]) {
    let match: RegExpExecArray | null;
    do {
      match = regex.exec(source);
      if (match?.[1]) specifiers.add(match[1]);
    } while (match);
  }

  return [...specifiers];
}

function normalizeCheckExclude(exclude: string | string[] | undefined): string[] {
  if (!exclude) return [];
  return Array.isArray(exclude) ? exclude : [exclude];
}

function pathIsExcluded(relativePath: string, excludes: string[]): boolean {
  return excludes.some(ex => relativePath.includes(toPosix(ex)));
}

function resolveImportTarget(
  projectRoot: string,
  fromRelativeFile: string,
  specifier: string,
  moduleSet: Set<string>,
): string | null {
  const normalized = toPosix(specifier);

  const candidateBases: string[] = [];
  if (normalized.startsWith('.')) {
    candidateBases.push(toPosix(path.normalize(path.join(path.dirname(fromRelativeFile), normalized))));
  } else if (normalized.startsWith('src/') || normalized.startsWith('server/') || normalized.startsWith('shared/') || normalized.startsWith('scripts/')) {
    candidateBases.push(normalized);
  } else {
    return null;
  }

  for (const base of candidateBases) {
    const expanded: string[] = [];
    if (hasModuleExtension(base)) {
      expanded.push(base);
    } else {
      for (const ext of MODULE_EXTENSIONS) expanded.push(`${base}${ext}`);
      for (const ext of MODULE_EXTENSIONS) expanded.push(toPosix(path.join(base, `index${ext}`)));
    }

    for (const candidate of expanded) {
      const rel = toPosix(path.normalize(candidate));
      if (moduleSet.has(rel)) return rel;
      const abs = path.resolve(projectRoot, rel);
      if (!moduleSet.has(rel) && fs.existsSync(abs) && fs.statSync(abs).isFile() && isModuleFile(rel)) {
        return rel;
      }
    }
  }

  return null;
}

function collectGitChurn(projectRoot: string, sinceDays: number): Map<string, number> {
  const churn = new Map<string, number>();
  const safeSinceDays = Number.isFinite(sinceDays) && sinceDays > 0 ? Math.floor(sinceDays) : 180;

  let output = '';
  try {
    output = execSync(`git log --since='${safeSinceDays} days ago' --name-only --pretty=format: -- .`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return churn;
  }

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const rel = toPosix(line);
    churn.set(rel, (churn.get(rel) ?? 0) + 1);
  }

  return churn;
}

function collectTestFiles(allFiles: string[]): { integrationTests: string[]; allTests: string[] } {
  const allTests = allFiles.filter(file => file.startsWith('tests/') && /\.(ts|tsx)$/.test(file));
  const integrationTests = allTests.filter(file => file.startsWith('tests/integration/'));
  return { integrationTests, allTests };
}

function inferOwner(modulePath: string): ModuleRoot {
  const root = MODULE_ROOTS.find(candidate => modulePath === candidate || modulePath.startsWith(`${candidate}/`));
  if (root) return root;
  return 'scripts';
}

function buildTestSignals(modulePath: string, allTestFiles: string[], testContentIndex: Map<string, string>): { hasTestReference: boolean; sampleTests: string[] } {
  const baseName = path.basename(modulePath, path.extname(modulePath)).toLowerCase();
  const normalized = modulePath.toLowerCase();

  const matches: string[] = [];
  for (const testFile of allTestFiles) {
    const lowerFile = testFile.toLowerCase();
    if (lowerFile.includes(baseName) || lowerFile.includes(path.basename(normalized))) {
      matches.push(testFile);
      continue;
    }

    const content = testContentIndex.get(testFile) ?? '';
    if (content.includes(normalized) || content.includes(baseName)) {
      matches.push(testFile);
    }
  }

  const unique = [...new Set(matches)].sort((a, b) => a.localeCompare(b));
  return {
    hasTestReference: unique.length > 0,
    sampleTests: unique.slice(0, 3),
  };
}

function hasNearbyIntegrationTest(routeModulePath: string, integrationTests: string[], integrationContentIndex: Map<string, string>): boolean {
  const routeName = path.basename(routeModulePath, path.extname(routeModulePath)).toLowerCase();
  const routeSegments = routeName.split('-').filter(Boolean);

  for (const testFile of integrationTests) {
    const lowerTestFile = testFile.toLowerCase();
    if (lowerTestFile.includes(routeName)) return true;

    const content = integrationContentIndex.get(testFile) ?? '';
    if (content.includes(routeName)) return true;

    const matchedSegments = routeSegments.filter(segment => segment.length >= 4 && content.includes(segment));
    if (matchedSegments.length >= Math.min(2, routeSegments.length)) return true;
  }

  return false;
}

function scoreComponent(value: number, maxForFullScore: number, weight: number): number {
  if (maxForFullScore <= 0) return 0;
  const normalized = Math.min(1, Math.max(0, value / maxForFullScore));
  return Math.round(normalized * weight * 100) / 100;
}

function computeScore(entry: Omit<ModuleRiskEntry, 'score' | 'scoreBreakdown'>): { score: number; breakdown: RiskScoreBreakdown } {
  const breakdown: RiskScoreBreakdown = {
    size: scoreComponent(entry.lineCount, 600, 20),
    churn: scoreComponent(entry.churnTouches, 24, 20),
    graph: scoreComponent(entry.fanIn + entry.fanOut, 20, 15),
    markers: scoreComponent(entry.todoCount + entry.hatchCommentCount, 8, 10),
    tests: entry.hasTestReference ? 0 : 15,
    routeWrites: entry.routeWriteWithoutIntegrationTest ? 10 : 0,
    warnings: scoreComponent(entry.prCheckWarningHits, 4, 10),
  };

  const score = Math.round((
    breakdown.size +
    breakdown.churn +
    breakdown.graph +
    breakdown.markers +
    breakdown.tests +
    breakdown.routeWrites +
    breakdown.warnings
  ) * 100) / 100;

  return { score, breakdown };
}

function collectPrCheckWarningHits(projectRoot: string, allRepoFiles: string[]): Map<string, number> {
  const warningHits = new Map<string, number>();
  const checks = CHECKS as PrCheck[];

  const readCandidateFiles = (check: PrCheck): string[] => {
    const fileGlobs = check.fileGlobs ?? [];
    const suffixes = fileGlobs
      .filter(glob => glob.startsWith('*.'))
      .map(glob => `.${glob.slice(2)}`);

    const pathFilter = check.pathFilter ? toPosix(check.pathFilter.replace(/\/$/, '')) : null;
    const excludes = normalizeCheckExclude(check.exclude);

    return allRepoFiles
      .filter(file => {
        if (pathFilter && !file.startsWith(pathFilter)) return false;
        if (excludes.length > 0 && pathIsExcluded(file, excludes)) return false;
        if (suffixes.length > 0 && !suffixes.some(suffix => file.endsWith(suffix))) return false;
        return true;
      })
      .map(file => path.resolve(projectRoot, file));
  };

  const addMatchLine = (line: string): void => {
    const matched = line.match(/^(.*?):\d+(?::\d+)?:/);
    const filePart = matched?.[1] ?? line.split(':')[0];
    if (!filePart) return;
    const rel = toPosix(path.relative(projectRoot, path.resolve(filePart)));
    warningHits.set(rel, (warningHits.get(rel) ?? 0) + 1);
  };

  for (const check of checks) {
    if (check.severity !== 'warn') continue;

    if (check.customCheck) {
      const files = readCandidateFiles(check);
      const customMatches = check.customCheck(files) ?? [];
      for (const match of customMatches) {
        const rel = toPosix(path.relative(projectRoot, path.resolve(match.file)));
        warningHits.set(rel, (warningHits.get(rel) ?? 0) + 1);
      }
      continue;
    }

    const target = check.pathFilter
      ? path.resolve(projectRoot, check.pathFilter)
      : projectRoot;

    const exists = fs.existsSync(target);
    if (!exists) continue;

    let matches: string[] = [];
    if (fs.statSync(target).isFile()) {
      matches = checkFile(target, check as never);
    } else {
      matches = checkDirectory(target, check as never);
    }

    for (const line of matches) addMatchLine(line);
  }

  return warningHits;
}

export function buildRiskyModuleDashboardReport(options: RiskyModuleOptions = {}): RiskyModuleDashboardReport {
  const projectRoot = path.resolve(options.projectRoot ?? ROOT);
  const sinceDays = Number.isFinite(options.sinceDays) && (options.sinceDays ?? 0) > 0
    ? Math.floor(options.sinceDays as number)
    : 180;
  const topN = Number.isFinite(options.topN) && (options.topN ?? 0) > 0
    ? Math.floor(options.topN as number)
    : 25;

  const allFiles = walkRepoFiles(projectRoot);
  const moduleFiles = allFiles.filter(isModuleFile);
  const moduleSet = new Set(moduleFiles);
  const churnByFile = collectGitChurn(projectRoot, sinceDays);
  const warningHits = collectPrCheckWarningHits(projectRoot, allFiles);

  const sourceByModule = new Map<string, string>();
  for (const moduleFile of moduleFiles) {
    const abs = path.resolve(projectRoot, moduleFile);
    sourceByModule.set(moduleFile, fs.readFileSync(abs, 'utf8'));
  }

  const dependencyOut = new Map<string, Set<string>>();
  const dependencyIn = new Map<string, Set<string>>();
  for (const moduleFile of moduleFiles) {
    dependencyOut.set(moduleFile, new Set<string>());
    dependencyIn.set(moduleFile, new Set<string>());
  }

  for (const moduleFile of moduleFiles) {
    const source = sourceByModule.get(moduleFile) ?? '';
    const imports = extractImportSpecifiers(source);
    for (const specifier of imports) {
      const target = resolveImportTarget(projectRoot, moduleFile, specifier, moduleSet);
      if (!target || target === moduleFile) continue;
      dependencyOut.get(moduleFile)?.add(target);
      dependencyIn.get(target)?.add(moduleFile);
    }
  }

  const { integrationTests, allTests } = collectTestFiles(allFiles);
  const testContentIndex = new Map<string, string>();
  const integrationContentIndex = new Map<string, string>();

  for (const testFile of allTests) {
    const content = fs.readFileSync(path.resolve(projectRoot, testFile), 'utf8').toLowerCase();
    testContentIndex.set(testFile, content);
    if (testFile.startsWith('tests/integration/')) integrationContentIndex.set(testFile, content);
  }

  const entries: ModuleRiskEntry[] = [];
  for (const moduleFile of moduleFiles) {
    const source = sourceByModule.get(moduleFile) ?? '';
    const markers = countRiskMarkers(source);
    const routeWriteHandlers = moduleFile.startsWith('server/routes/') ? countRouteWriteHandlers(source) : 0;
    const testSignal = buildTestSignals(moduleFile, allTests, testContentIndex);
    const routeWriteWithoutIntegrationTest = routeWriteHandlers > 0
      ? !hasNearbyIntegrationTest(moduleFile, integrationTests, integrationContentIndex)
      : false;

    const baseEntry = {
      module: moduleFile,
      owner: inferOwner(moduleFile),
      lineCount: source.split(/\r?\n/).length,
      churnTouches: churnByFile.get(moduleFile) ?? 0,
      fanIn: dependencyIn.get(moduleFile)?.size ?? 0,
      fanOut: dependencyOut.get(moduleFile)?.size ?? 0,
      todoCount: markers.todoCount,
      hatchCommentCount: markers.hatchCommentCount,
      hasTestReference: testSignal.hasTestReference,
      routeWriteHandlers,
      routeWriteWithoutIntegrationTest,
      prCheckWarningHits: warningHits.get(moduleFile) ?? 0,
      sampleTests: testSignal.sampleTests,
    } satisfies Omit<ModuleRiskEntry, 'score' | 'scoreBreakdown'>;

    const scored = computeScore(baseEntry);
    entries.push({
      ...baseEntry,
      score: scored.score,
      scoreBreakdown: scored.breakdown,
    });
  }

  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.prCheckWarningHits !== a.prCheckWarningHits) return b.prCheckWarningHits - a.prCheckWarningHits;
    return b.lineCount - a.lineCount;
  });

  const topRiskModules = entries.slice(0, topN);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    sinceDays,
    moduleCount: entries.length,
    topN,
    metrics: {
      modulesWithoutTests: entries.filter(entry => !entry.hasTestReference).length,
      routeFilesWithoutIntegrationCoverage: entries.filter(entry => entry.routeWriteWithoutIntegrationTest).length,
      warningHitFiles: entries.filter(entry => entry.prCheckWarningHits > 0).length,
    },
    topRiskModules,
  };
}

export function formatRiskyModuleDashboardMarkdown(report: RiskyModuleDashboardReport): string {
  const lines: string[] = [];
  lines.push('# Risky Module Health Dashboard');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Window: last ${report.sinceDays} days of git churn`);
  lines.push(`- Modules analyzed: ${report.moduleCount}`);
  lines.push(`- Modules without test linkage: ${report.metrics.modulesWithoutTests}`);
  lines.push(`- Route modules with write handlers but no nearby integration tests: ${report.metrics.routeFilesWithoutIntegrationCoverage}`);
  lines.push(`- Modules with pr-check warning hits: ${report.metrics.warningHitFiles}`);
  lines.push('');
  lines.push('## Top Risk Modules');
  lines.push('');
  lines.push('| Rank | Module | Score | Lines | Churn | Fan (in/out) | TODO+Hatch | Test linked | Route write gap | pr-check warn hits |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |');

  report.topRiskModules.forEach((entry, index) => {
    const routeGap = entry.routeWriteWithoutIntegrationTest ? `yes (${entry.routeWriteHandlers})` : (entry.routeWriteHandlers > 0 ? `no (${entry.routeWriteHandlers})` : 'n/a');
    const tests = entry.hasTestReference ? `yes (${entry.sampleTests.length})` : 'no';
    const fan = `${entry.fanIn}/${entry.fanOut}`;
    const markers = entry.todoCount + entry.hatchCommentCount;
    lines.push(`| ${index + 1} | \`${entry.module}\` | ${entry.score.toFixed(2)} | ${entry.lineCount} | ${entry.churnTouches} | ${fan} | ${markers} | ${tests} | ${routeGap} | ${entry.prCheckWarningHits} |`);
  });

  lines.push('');
  lines.push('## Scoring Weights');
  lines.push('- Size (line count): 20');
  lines.push('- Churn touches (git history window): 20');
  lines.push('- Import graph fan-in/fan-out: 15');
  lines.push('- TODO/FIXME/HACK + hatch comment density: 10');
  lines.push('- No test linkage: 15');
  lines.push('- Route write handlers without nearby integration test: 10');
  lines.push('- pr-check warning concentration: 10');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

export function parseCliArgs(args: string[]): CliOptions | null {
  let json = false;
  let topN = 25;
  let sinceDays = 180;
  let help = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--top') {
      const raw = args[i + 1];
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      topN = Math.floor(parsed);
      i += 1;
      continue;
    }

    if (arg === '--since-days') {
      const raw = args[i + 1];
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      sinceDays = Math.floor(parsed);
      i += 1;
      continue;
    }

    return null;
  }

  return { json, topN, sinceDays, help };
}

function printUsage(): void {
  console.error('Usage: npm run verify:risky-modules -- [--json] [--top N] [--since-days N]');
}

export function runRiskyModuleDashboardCli(argv: string[]): number {
  const parsed = parseCliArgs(argv);
  if (!parsed) {
    printUsage();
    return 1;
  }

  if (parsed.help) {
    printUsage();
    return 0;
  }

  const report = buildRiskyModuleDashboardReport({
    projectRoot: ROOT,
    topN: parsed.topN,
    sinceDays: parsed.sinceDays,
  });

  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatRiskyModuleDashboardMarkdown(report));
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runRiskyModuleDashboardCli(process.argv.slice(2)));
}
