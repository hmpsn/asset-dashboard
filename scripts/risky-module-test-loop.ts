#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  type ModuleRiskEntry,
  buildRiskyModuleDashboardReport,
} from './platform-risky-module-dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

type CliOptions = {
  maxCycles: number;
  topN: number;
  sinceDays: number;
  topStep: number;
  untilExhausted: boolean;
  includeScripts: boolean;
};

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function parseArgs(args: string[]): CliOptions | null {
  let maxCycles = 10;
  let topN = 40;
  let sinceDays = 180;
  let topStep = 0;
  let untilExhausted = false;
  let includeScripts = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--max-cycles') {
      const raw = args[i + 1];
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      maxCycles = Math.floor(parsed);
      i += 1;
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

    if (arg === '--top-step') {
      const raw = args[i + 1];
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      topStep = Math.floor(parsed);
      i += 1;
      continue;
    }

    if (arg === '--until-exhausted') {
      untilExhausted = true;
      continue;
    }

    if (arg === '--include-scripts') {
      includeScripts = true;
      continue;
    }

    return null;
  }

  return { maxCycles, topN, sinceDays, topStep, untilExhausted, includeScripts };
}

function printUsage(): void {
  console.error('Usage: tsx scripts/risky-module-test-loop.ts [--max-cycles N] [--top N] [--since-days N] [--top-step N] [--until-exhausted] [--include-scripts]');
}

function slugForModule(modulePath: string): string {
  return modulePath
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function pickTestFile(modulePath: string): { absoluteTestFile: string; componentProject: boolean } {
  const ext = path.extname(modulePath).toLowerCase();
  const relativeNoExt = modulePath.replace(/\.[^.]+$/, '');
  const moduleDir = path.dirname(relativeNoExt);
  const base = path.basename(relativeNoExt);
  const isComponentModule = moduleDir === 'src/components' || moduleDir.startsWith('src/components/');
  const conventionalComponentDir = moduleDir === 'src/components'
    ? ''
    : moduleDir.replace(/^src\/components\//, '');

  if (ext === '.tsx') {
    if (isComponentModule) {
      const absoluteTestFile = path.resolve(
        ROOT,
        'tests/component',
        conventionalComponentDir,
        `${base}.risky.test.tsx`,
      );
      return { absoluteTestFile, componentProject: true };
    }

    const slug = slugForModule(modulePath);
    const absoluteTestFile = path.resolve(ROOT, 'tests/component', `${slug}.risky.test.tsx`);
    return { absoluteTestFile, componentProject: true };
  }

  const conventionalUnitDir = moduleDir.replace(/^(src|server|shared|scripts)\//, '');
  const absoluteTestFile = path.resolve(
    ROOT,
    'tests/unit',
    conventionalUnitDir,
    `${base}.risky.test.ts`,
  );
  return { absoluteTestFile, componentProject: false };
}

function buildImportPath(absoluteTestFile: string, modulePath: string): string {
  const absoluteModule = path.resolve(ROOT, modulePath);
  const fromDir = path.dirname(absoluteTestFile);
  const rawRelative = toPosix(path.relative(fromDir, absoluteModule));
  return rawRelative.startsWith('.') ? rawRelative : `./${rawRelative}`;
}

function buildTestSource(entry: ModuleRiskEntry, importPath: string): string {
  return `import { describe, expect, it } from 'vitest';

describe('risky module smoke: ${entry.module}', () => {
  it('loads without throwing', async () => {
    const loaded = await import('${importPath}');
    expect(loaded).toBeDefined();
  });
});
`;
}

type GeneratedTest = {
  module: string;
  testFile: string;
  componentProject: boolean;
};

function isSmokeTestTarget(modulePath: string, options: CliOptions): boolean {
  const normalized = toPosix(modulePath);
  if (!options.includeScripts && normalized.startsWith('scripts/')) return false;
  if (normalized.includes('/__tests__/')) return false;
  if (/\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(normalized)) return false;
  return true;
}

function generateTests(entries: ModuleRiskEntry[], options: CliOptions): GeneratedTest[] {
  const generated: GeneratedTest[] = [];

  for (const entry of entries) {
    if (!isSmokeTestTarget(entry.module, options)) continue;

    const { absoluteTestFile, componentProject } = pickTestFile(entry.module);
    if (fs.existsSync(absoluteTestFile)) continue;

    fs.mkdirSync(path.dirname(absoluteTestFile), { recursive: true });
    const importPath = buildImportPath(absoluteTestFile, entry.module);
    const source = buildTestSource(entry, importPath);
    fs.writeFileSync(absoluteTestFile, source, 'utf8');

    generated.push({
      module: entry.module,
      testFile: absoluteTestFile,
      componentProject,
    });
  }

  return generated;
}

function runGeneratedTests(generated: GeneratedTest[]): void {
  const unitTests = generated.filter(item => !item.componentProject).map(item => toPosix(path.relative(ROOT, item.testFile)));
  const componentTests = generated.filter(item => item.componentProject).map(item => toPosix(path.relative(ROOT, item.testFile)));

  if (unitTests.length > 0) {
    execSync(`npx vitest run --project unit ${unitTests.join(' ')}`, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  }

  if (componentTests.length > 0) {
    execSync(`npx vitest run --project component ${componentTests.join(' ')}`, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  }
}

function runLoop(options: CliOptions): number {
  const seenRisky = new Set<string>();
  let totalGenerated = 0;
  let cycle = 0;

  for (cycle = 1; cycle <= options.maxCycles; cycle += 1) {
    let cycleTopN = options.topN + ((cycle - 1) * options.topStep);
    if (options.untilExhausted) cycleTopN = Number.MAX_SAFE_INTEGER;
    const report = buildRiskyModuleDashboardReport({
      projectRoot: ROOT,
      topN: cycleTopN,
      sinceDays: options.sinceDays,
    });

    const riskyWithoutTests = report.topRiskModules.filter(entry => !entry.hasTestReference);
    const newRisky = riskyWithoutTests.filter(entry => !seenRisky.has(entry.module));
    for (const entry of riskyWithoutTests) seenRisky.add(entry.module);

    console.log(`\nCycle ${cycle}/${options.maxCycles}`);
    const displayTop = options.untilExhausted ? 'ALL' : `${cycleTopN}`;
    console.log(`Top-risk modules analyzed: ${report.topRiskModules.length} (top=${displayTop})`);
    console.log(`Global modules without test linkage: ${report.metrics.modulesWithoutTests}`);
    console.log(`Risky modules without test linkage this cycle: ${riskyWithoutTests.length}`);
    console.log(`New risky modules this cycle: ${newRisky.length}`);

    if (options.untilExhausted && report.metrics.modulesWithoutTests === 0) {
      console.log('Stopping: no unlinked modules remain in the full report.');
      break;
    }

    if (newRisky.length === 0) {
      if (options.topStep > 0 && cycle < options.maxCycles) {
        console.log('No new risky modules at this window; continuing to next widened top window.');
        continue;
      }
      console.log('Stopping: no new risky modules found.');
      break;
    }

    const generated = generateTests(newRisky, options);
    totalGenerated += generated.length;

    if (generated.length === 0) {
      console.log('No new test files were created for newly seen risky modules.');
      continue;
    }

    console.log(`Generated ${generated.length} test files.`);
    runGeneratedTests(generated);
  }

  const finalReport = buildRiskyModuleDashboardReport({
    projectRoot: ROOT,
    topN: options.topN,
    sinceDays: options.sinceDays,
  });
  const finalRiskyWithoutTests = finalReport.topRiskModules.filter(entry => !entry.hasTestReference).length;

  console.log('\nLoop summary');
  console.log(`Cycles executed: ${Math.min(cycle, options.maxCycles)}`);
  console.log(`Total generated test files: ${totalGenerated}`);
  console.log(`Remaining top-risk modules without test linkage: ${finalRiskyWithoutTests}`);

  return 0;
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) {
  printUsage();
  process.exit(1);
}

process.exit(runLoop(parsed));
