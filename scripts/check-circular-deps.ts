import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface CircularDependencyBaseline {
  cycles: Record<string, number>;
  allowedDirectRouteDbIndexImports: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const baselinePath = path.join(repoRoot, 'data/circular-dependency-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as CircularDependencyBaseline;
const madgeBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const routeDbTarget = path.join(repoRoot, 'server/db/index.js');

let failed = false;

function runMadge(target: string): unknown[] {
  const result = spawnSync(
    madgeBin,
    ['madge', '--circular', '--extensions', 'ts,tsx', '--json', target],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  if (result.error) {
    throw result.error;
  }

  try {
    return JSON.parse(result.stdout || '[]') as unknown[];
  } catch (err) {
    console.error(`[circular-deps] Failed to parse madge output for ${target}`);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    throw err;
  }
}

function checkCircularDependencyRatchet(): void {
  for (const [target, allowedCount] of Object.entries(baseline.cycles)) {
    const cycles = runMadge(target);
    const count = cycles.length;
    if (count > allowedCount) {
      failed = true;
      console.error(`[circular-deps] ${target}: ${count} cycles exceeds baseline ${allowedCount}`);
    } else {
      const delta = allowedCount - count;
      const suffix = delta > 0 ? ` (${delta} below baseline)` : '';
      console.log(`[circular-deps] ${target}: ${count}/${allowedCount} cycles${suffix}`);
    }
  }
}

function listTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

function findDirectRouteDbImports(): string[] {
  const routesDir = path.join(repoRoot, 'server/routes');
  const files = listTsFiles(routesDir);
  const offenders = new Set<string>();

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const importSources = source.matchAll(/from\s+['"]([^'"]+)['"]/g);
    for (const match of importSources) {
      const imported = match[1];
      if (!imported.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), imported);
      if (resolved === routeDbTarget) {
        offenders.add(path.relative(repoRoot, file).replaceAll(path.sep, '/'));
      }
    }
  }

  return [...offenders].sort();
}

function checkRouteDbImportGuard(): void {
  const allowed = new Set(baseline.allowedDirectRouteDbIndexImports);
  const actual = findDirectRouteDbImports();
  const unbaselined = actual.filter(file => !allowed.has(file));

  if (unbaselined.length > 0) {
    failed = true;
    console.error('[route-db-imports] New direct server/routes -> server/db/index imports are not allowed:');
    for (const file of unbaselined) console.error(`  - ${file}`);
  } else {
    console.log(`[route-db-imports] ${actual.length}/${allowed.size} direct route DB imports are covered by the baseline`);
  }

  const stale = [...allowed].filter(file => !actual.includes(file));
  if (stale.length > 0) {
    console.log('[route-db-imports] Baseline includes files that no longer import the DB singleton:');
    for (const file of stale) console.log(`  - ${file}`);
    console.log('[route-db-imports] Consider lowering the baseline in data/circular-dependency-baseline.json.');
  }
}

checkCircularDependencyRatchet();
checkRouteDbImportGuard();

if (failed) {
  process.exit(1);
}
