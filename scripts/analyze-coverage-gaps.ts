#!/usr/bin/env tsx
/**
 * Reads coverage/coverage-final.json and outputs the top uncovered server files
 * sorted by uncovered line count descending.
 */

import { readFileSync, existsSync } from 'node:fs';

type FileCoverage = {
  s: Record<string, number>; // statements
  b: Record<string, number[]>; // branches
  f: Record<string, number>; // functions
  fnMap: Record<string, { name: string; loc: { start: { line: number } } }>;
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  branchMap: Record<string, { type: string; locations: unknown[] }>;
};

type CoverageFinal = Record<string, FileCoverage>;

const finalPath = 'coverage/coverage-final.json';
const summaryPath = 'coverage/coverage-summary.json';

if (!existsSync(finalPath)) {
  console.error(`Missing ${finalPath}. Run: npx vitest run --coverage`);
  process.exit(1);
}

const final = JSON.parse(readFileSync(finalPath, 'utf8')) as CoverageFinal;

type FileStats = {
  file: string;
  totalStatements: number;
  coveredStatements: number;
  uncoveredStatements: number;
  totalFunctions: number;
  coveredFunctions: number;
  pctStatements: number;
  pctFunctions: number;
};

const stats: FileStats[] = [];

for (const [filePath, cov] of Object.entries(final)) {
  // Normalize to relative path
  const rel = filePath.replace(/^.*\/asset-dashboard\//, '');

  // Only server files
  if (!rel.startsWith('server/')) continue;

  const totalStatements = Object.keys(cov.s).length;
  const coveredStatements = Object.values(cov.s).filter(n => n > 0).length;
  const uncoveredStatements = totalStatements - coveredStatements;

  const totalFunctions = Object.keys(cov.f).length;
  const coveredFunctions = Object.values(cov.f).filter(n => n > 0).length;

  const pctStatements = totalStatements === 0 ? 100 : Math.round((coveredStatements / totalStatements) * 100);
  const pctFunctions = totalFunctions === 0 ? 100 : Math.round((coveredFunctions / totalFunctions) * 100);

  stats.push({ file: rel, totalStatements, coveredStatements, uncoveredStatements, totalFunctions, coveredFunctions, pctStatements, pctFunctions });
}

// Sort by uncovered statements descending
stats.sort((a, b) => b.uncoveredStatements - a.uncoveredStatements);

const limit = Number(process.argv[2]) || 40;
const showAll = process.argv.includes('--all');
const filtered = showAll ? stats : stats.filter(s => s.pctStatements < 90);

console.log(`\nTop ${limit} server files by uncovered statements (pct < 90%):\n`);
console.log('Rank | Uncovered | Total | % Stmts | % Fns | File');
console.log('-----|-----------|-------|---------|-------|-----');

let rank = 1;
for (const s of filtered.slice(0, limit)) {
  console.log(
    `${String(rank).padStart(4)} | ${String(s.uncoveredStatements).padStart(9)} | ${String(s.totalStatements).padStart(5)} | ${String(s.pctStatements).padStart(6)}% | ${String(s.pctFunctions).padStart(4)}% | ${s.file}`
  );
  rank++;
}

// Summary
const totalUncovered = stats.reduce((sum, s) => sum + s.uncoveredStatements, 0);
const totalStatements = stats.reduce((sum, s) => sum + s.totalStatements, 0);
const zeroCoverage = stats.filter(s => s.pctStatements === 0);
console.log(`\nTotal server statements: ${totalStatements} | Uncovered: ${totalUncovered} | Zero-coverage files: ${zeroCoverage.length}`);
