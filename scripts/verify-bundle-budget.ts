#!/usr/bin/env tsx

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
  entries: Record<string, number>;
};

type BudgetEntry = {
  name: string;
  gzipBytes: number;
  baselineBytes?: number;
  budgetBytes?: number;
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

function readBaseline(baselinePath: string): BundleBudgetBaseline | null {
  if (!existsSync(baselinePath)) return null;
  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8')) as Partial<BundleBudgetBaseline>;
  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    tolerance: typeof parsed.tolerance === 'number' ? parsed.tolerance : DEFAULT_TOLERANCE,
    entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
  };
}

function canonicalChunkName(entryName: string, entry: ManifestEntry): string {
  if (entry.src) return `js:${entry.src.replaceAll('\\', '/')}`;
  if (entry.name) return `js:${entry.name}`;
  return `js:${stripAssetHash(entryName.replace(/^_/, '').replaceAll('\\', '/'))}`;
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

  return Array.from(entriesByFile.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function stripAssetHash(file: string): string {
  const normalized = file.replaceAll('\\', '/');
  const parsed = path.posix.parse(normalized);
  const nameWithoutHash = parsed.name.replace(/-[A-Za-z0-9_-]{8,}$/, '');
  return path.posix.join(parsed.dir, `${nameWithoutHash}${parsed.ext}`);
}

function shouldBudgetStaticAsset(file: string): boolean {
  return BUDGETED_STATIC_EXTENSIONS.has(path.posix.extname(file.replaceAll('\\', '/')));
}

function canonicalStaticAssetName(file: string): string {
  const normalized = file.replace(/^\/+/, '').replaceAll('\\', '/');
  const extension = path.posix.extname(normalized);
  if (extension === '.css') return `css:${stripAssetHash(normalized)}`;
  if (['.woff2', '.woff', '.ttf', '.otf'].includes(extension)) return `font:${normalized}`;
  return `asset:${stripAssetHash(normalized)}`;
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
  const payload: BundleBudgetBaseline = {
    version: 1,
    updatedAt: new Date().toISOString(),
    tolerance: DEFAULT_TOLERANCE,
    entries: Object.fromEntries(entries.map(entry => [entry.name, entry.gzipBytes])),
  };
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
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

  const regressions: BudgetEntry[] = [];
  const newEntries: BudgetEntry[] = [];

  for (const entry of entries) {
    const baselineBytes = baseline.entries[entry.name];
    if (baselineBytes == null) {
      newEntries.push(entry);
      continue;
    }
    const budgetBytes = Math.ceil(baselineBytes * (1 + baseline.tolerance));
    if (entry.gzipBytes > budgetBytes) {
      regressions.push({ ...entry, baselineBytes, budgetBytes });
    }
  }

  if (newEntries.length > 0) {
    console.warn(`Bundle budget warning: ${newEntries.length} new bundle assets are missing baseline entries.`);
    for (const entry of newEntries) {
      console.warn(`  - ${entry.name}: ${formatBytes(entry.gzipBytes)} gzip`);
    }
  }

  if (regressions.length > 0) {
    console.error(`Bundle budget failed: ${regressions.length} bundle assets exceed the ${(baseline.tolerance * 100).toFixed(0)}% tolerance.`);
    for (const entry of regressions) {
      console.error(
        `  - ${entry.name}: ${formatBytes(entry.baselineBytes ?? 0)} baseline -> ${formatBytes(entry.gzipBytes)} current (budget ${formatBytes(entry.budgetBytes ?? 0)})`,
      );
    }
    process.exit(1);
  }

  console.log(`Bundle budget passed: ${entries.length} bundle assets checked against ${toRepoRel(args.baselinePath)}.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
