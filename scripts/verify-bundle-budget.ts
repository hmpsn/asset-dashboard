#!/usr/bin/env tsx

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

type ManifestEntry = {
  file?: string;
  src?: string;
  name?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  css?: string[];
  assets?: string[];
};

type ManifestFile = Record<string, ManifestEntry>;

type BundleBudgetBaseline = {
  version: 1;
  updatedAt: string;
  tolerance: number;
  /** Sum of every entry's gzip bytes — the aggregate ceiling that catches route splits/renames. */
  total: number;
  entries: Record<string, number>;
};

export type BudgetEntry = {
  name: string;
  gzipBytes: number;
  baselineBytes?: number;
  budgetBytes?: number;
};

export type BudgetEvaluation = {
  /** Baselined assets that grew past their per-entry budget. */
  regressions: BudgetEntry[];
  /** Every un-baselined asset (surfaced as warnings). */
  newEntries: BudgetEntry[];
  /** Un-baselined assets over the absolute cap — these FAIL the gate, not just warn. */
  oversizeNewEntries: BudgetEntry[];
  currentTotal: number;
  totalBudget: number;
  totalExceeded: boolean;
};

type CliArgs = {
  update: boolean;
  manifestPath: string;
  baselinePath: string;
};

const ROOT = path.join(import.meta.dirname, '..');
const DEFAULT_MANIFEST_PATH = path.join(ROOT, 'dist/.vite/manifest.json');
const DEFAULT_BASELINE_PATH = path.join(ROOT, 'data/bundle-budget-baseline.json');
const DEFAULT_TOLERANCE = 0.05;
/**
 * A brand-new chunk (no baseline entry) above this gzip size FAILS the gate rather than
 * only warning — otherwise a net-new heavy route/chunk ships green, defeating the ratchet
 * for exactly the case that matters most. Tiny new chunks (icons, constants) stay warn-only
 * so routine code-splitting does not block PRs.
 */
export const NEW_ASSET_CAP_BYTES = 50 * 1024;
/**
 * Per-entry budgets get at least this much absolute slack on top of the % tolerance, so a
 * trivial byte-shift on a sub-KB chunk (137B -> 145B) does not hard-fail CI and train the
 * team to reflexively `--update` (which would silently re-baseline real regressions).
 */
export const MIN_SLACK_BYTES = 512;
const BUDGETED_STATIC_EXTENSIONS = new Set(['.css', '.woff2', '.woff', '.ttf', '.otf']);

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    update: false,
    manifestPath: DEFAULT_MANIFEST_PATH,
    baselinePath: DEFAULT_BASELINE_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--update') {
      args.update = true;
      continue;
    }
    if (arg === '--manifest') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --manifest');
      args.manifestPath = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--baseline') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --baseline');
      args.baselinePath = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function toRepoRel(absPath: string): string {
  return path.relative(ROOT, absPath).replaceAll('\\', '/');
}

function readManifest(manifestPath: string): ManifestFile {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Missing Vite manifest at ${toRepoRel(manifestPath)}. Run \`npx vite build --manifest\` first.`,
    );
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestFile;
}

function sumEntryBytes(entries: Record<string, number>): number {
  return Object.values(entries).reduce((total, bytes) => total + bytes, 0);
}

function readBaseline(baselinePath: string): BundleBudgetBaseline | null {
  if (!existsSync(baselinePath)) return null;
  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8')) as Partial<BundleBudgetBaseline>;
  const entries = parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    tolerance: typeof parsed.tolerance === 'number' ? parsed.tolerance : DEFAULT_TOLERANCE,
    total: typeof parsed.total === 'number' ? parsed.total : sumEntryBytes(entries),
    entries,
  };
}

export function stripAssetHash(file: string): string {
  const normalized = file.replaceAll('\\', '/');
  const parsed = path.posix.parse(normalized);
  const nameWithoutHash = parsed.name.replace(/-[A-Za-z0-9_-]{8,}$/, '');
  return path.posix.join(parsed.dir, `${nameWithoutHash}${parsed.ext}`);
}

export function canonicalChunkName(entryName: string, entry: ManifestEntry): string {
  const src = entry.src?.replaceAll('\\', '/');
  // Vite's HTML entry sets src='index.html'; naming the emitted JS chunk after the HTML
  // file is misleading (it is the main app bundle, not the document), so for an html-src
  // entry fall through to the chunk name / emitted file basename instead.
  if (src && !src.toLowerCase().endsWith('.html')) return `js:${src}`;
  if (entry.name) return `js:${entry.name}`;
  const base = entry.file ? path.posix.basename(entry.file) : entryName;
  return `js:${stripAssetHash(base.replace(/^_/, '').replaceAll('\\', '/'))}`;
}

export function canonicalStaticAssetName(file: string): string {
  const normalized = file.replace(/^\/+/, '').replaceAll('\\', '/');
  const extension = path.posix.extname(normalized);
  if (extension === '.css') return `css:${stripAssetHash(normalized)}`;
  if (['.woff2', '.woff', '.ttf', '.otf'].includes(extension)) return `font:${normalized}`;
  return `asset:${stripAssetHash(normalized)}`;
}

function shouldBudgetStaticAsset(file: string): boolean {
  return BUDGETED_STATIC_EXTENSIONS.has(path.posix.extname(file.replaceAll('\\', '/')));
}

/**
 * Distinct emitted files must never reduce to the same canonical budget key. Because the
 * baseline is keyed by name, a collision would silently keep only one file's budget while
 * the other rides free — a real regression could ship green. Fail loudly instead.
 */
function assertNoNameCollisions(entriesByFile: Map<string, BudgetEntry>): void {
  const filesByName = new Map<string, string[]>();
  for (const [file, entry] of entriesByFile) {
    const files = filesByName.get(entry.name) ?? [];
    files.push(file);
    filesByName.set(entry.name, files);
  }
  const collisions = [...filesByName].filter(([, files]) => files.length > 1);
  if (collisions.length > 0) {
    const detail = collisions.map(([name, files]) => `${name} <- ${files.join(' + ')}`).join('; ');
    throw new Error(
      `Bundle budget: ${collisions.length} canonical name collision(s) — distinct files reduce to one budget key and would silently drop coverage: ${detail}. Make canonicalChunkName/stripAssetHash more specific.`,
    );
  }
}

function collectBudgetEntries(manifestPath: string, manifest: ManifestFile): BudgetEntry[] {
  const distRoot = path.resolve(path.dirname(manifestPath), '..');
  const entriesByFile = new Map<string, BudgetEntry>();

  function addBudgetFile(name: string, file: string): void {
    const normalizedFile = file.replace(/^\/+/, '').replaceAll('\\', '/');
    if (entriesByFile.has(normalizedFile)) return;

    const assetPath = path.join(distRoot, normalizedFile);
    if (!existsSync(assetPath)) {
      throw new Error(`Manifest references missing bundle asset ${normalizedFile}`);
    }

    const source = readFileSync(assetPath);
    entriesByFile.set(normalizedFile, {
      name,
      gzipBytes: gzipSync(source).length,
    });
  }

  for (const [entryName, entry] of Object.entries(manifest)) {
    if (entry.file?.endsWith('.js')) {
      addBudgetFile(canonicalChunkName(entryName, entry), entry.file);
    } else if (entry.file && shouldBudgetStaticAsset(entry.file)) {
      addBudgetFile(canonicalStaticAssetName(entry.file), entry.file);
    }

    for (const cssFile of entry.css ?? []) {
      addBudgetFile(canonicalStaticAssetName(cssFile), cssFile);
    }

    for (const assetFile of entry.assets ?? []) {
      if (shouldBudgetStaticAsset(assetFile)) addBudgetFile(canonicalStaticAssetName(assetFile), assetFile);
    }
  }

  for (const staticAsset of readIndexLinkedStaticAssets(distRoot)) {
    addBudgetFile(canonicalStaticAssetName(staticAsset), staticAsset);
  }

  assertNoNameCollisions(entriesByFile);

  return Array.from(entriesByFile.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function readIndexLinkedStaticAssets(distRoot: string): string[] {
  const indexPath = path.join(distRoot, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`Missing built index.html next to ${toRepoRel(distRoot)}. Run \`npx vite build --manifest\` first.`);
  }

  const html = readFileSync(indexPath, 'utf8');
  const assets = new Set<string>();
  const hrefPattern = /<link\b[^>]*\bhref=(["'])(.*?)\1/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html)) !== null) {
    const href = match[2];
    if (!href.startsWith('/') || href.startsWith('//')) continue;

    const withoutQuery = href.split(/[?#]/, 1)[0]?.replace(/^\/+/, '');
    if (!withoutQuery || !shouldBudgetStaticAsset(withoutQuery)) continue;
    assets.add(withoutQuery);
  }

  return Array.from(assets).sort();
}

function writeBaseline(baselinePath: string, entries: BudgetEntry[]): void {
  mkdirSync(path.dirname(baselinePath), { recursive: true });
  const entryMap = Object.fromEntries(entries.map(entry => [entry.name, entry.gzipBytes]));
  const payload: BundleBudgetBaseline = {
    version: 1,
    updatedAt: new Date().toISOString(),
    tolerance: DEFAULT_TOLERANCE,
    total: sumEntryBytes(entryMap),
    entries: entryMap,
  };
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

/**
 * Pure comparison of a built asset set against a baseline. Extracted (and exported) so the
 * per-entry budget math, the new-asset cap, and the aggregate ceiling are unit-testable
 * without a filesystem — the regex/naming logic above is the fragile part most worth covering.
 */
export function evaluateBudget(
  entries: BudgetEntry[],
  baseline: BundleBudgetBaseline,
  opts: { newAssetCapBytes?: number; minSlackBytes?: number } = {},
): BudgetEvaluation {
  const cap = opts.newAssetCapBytes ?? NEW_ASSET_CAP_BYTES;
  const slack = opts.minSlackBytes ?? MIN_SLACK_BYTES;

  const regressions: BudgetEntry[] = [];
  const newEntries: BudgetEntry[] = [];
  const oversizeNewEntries: BudgetEntry[] = [];

  for (const entry of entries) {
    const baselineBytes = baseline.entries[entry.name];
    if (baselineBytes == null) {
      newEntries.push(entry);
      if (entry.gzipBytes > cap) oversizeNewEntries.push({ ...entry, budgetBytes: cap });
      continue;
    }
    const budgetBytes = Math.max(Math.ceil(baselineBytes * (1 + baseline.tolerance)), baselineBytes + slack);
    if (entry.gzipBytes > budgetBytes) regressions.push({ ...entry, baselineBytes, budgetBytes });
  }

  const currentTotal = entries.reduce((sum, entry) => sum + entry.gzipBytes, 0);
  const totalBudget = Math.max(Math.ceil(baseline.total * (1 + baseline.tolerance)), baseline.total + slack);

  return {
    regressions,
    newEntries,
    oversizeNewEntries,
    currentTotal,
    totalBudget,
    totalExceeded: currentTotal > totalBudget,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readManifest(args.manifestPath);
  const entries = collectBudgetEntries(args.manifestPath, manifest);

  if (entries.length === 0) {
    throw new Error('No entry or dynamic-entry JS chunks found in the Vite manifest.');
  }

  if (args.update) {
    writeBaseline(args.baselinePath, entries);
    console.log(`Updated bundle budget baseline with ${entries.length} bundle assets: ${toRepoRel(args.baselinePath)}`);
    return;
  }

  const baseline = readBaseline(args.baselinePath);
  if (!baseline) {
    throw new Error(`Missing bundle budget baseline at ${toRepoRel(args.baselinePath)}. Run \`npm run verify:bundle-budget -- --update\`.`);
  }

  const result = evaluateBudget(entries, baseline);

  if (result.newEntries.length > 0) {
    console.warn(
      `Bundle budget warning: ${result.newEntries.length} new bundle assets have no baseline entry (warn-only under ${formatBytes(NEW_ASSET_CAP_BYTES)} gzip).`,
    );
    for (const entry of result.newEntries) {
      console.warn(`  - ${entry.name}: ${formatBytes(entry.gzipBytes)} gzip`);
    }
  }

  const failures: string[] = [];

  if (result.oversizeNewEntries.length > 0) {
    failures.push(`${result.oversizeNewEntries.length} new bundle assets exceed the ${formatBytes(NEW_ASSET_CAP_BYTES)} gzip cap`);
    for (const entry of result.oversizeNewEntries) {
      console.error(
        `  - NEW ${entry.name}: ${formatBytes(entry.gzipBytes)} gzip (cap ${formatBytes(NEW_ASSET_CAP_BYTES)}) — re-baseline with \`--update\` only if this size is intended`,
      );
    }
  }

  if (result.regressions.length > 0) {
    failures.push(`${result.regressions.length} bundle assets exceed the ${(baseline.tolerance * 100).toFixed(0)}% tolerance`);
    for (const entry of result.regressions) {
      console.error(
        `  - ${entry.name}: ${formatBytes(entry.baselineBytes ?? 0)} baseline -> ${formatBytes(entry.gzipBytes)} current (budget ${formatBytes(entry.budgetBytes ?? 0)})`,
      );
    }
  }

  if (result.totalExceeded) {
    failures.push(
      `aggregate bundle gzip ${formatBytes(result.currentTotal)} exceeds the total budget ${formatBytes(result.totalBudget)} (baseline ${formatBytes(baseline.total)})`,
    );
  }

  if (failures.length > 0) {
    console.error(`Bundle budget failed: ${failures.join('; ')}.`);
    process.exit(1);
  }

  console.log(
    `Bundle budget passed: ${entries.length} bundle assets (${formatBytes(result.currentTotal)} gzip total) checked against ${toRepoRel(args.baselinePath)}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
