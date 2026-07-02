#!/usr/bin/env tsx
/**
 * lexicon-registry.ts — verify:lexicon
 *
 * Promotes GLOSSARY.md from a reference document into an ENFORCED contract.
 * Modeled on scripts/feature-flag-lifecycle.ts (pure report-builder functions +
 * a CLI main that exits 1 on drift).
 *
 * Checks:
 *   (a) GLOSSARY.md ↔ registry parity in BOTH directions (every registry term has a
 *       GLOSSARY entry and vice versa).
 *   (b) Live duplicate-exported-name scan of shared/ + server/ vs the allowlist — a
 *       collision not on the allowlist fails.
 *   (c) Allowlist hygiene — every entry carries a non-empty resolvingTicket.
 *
 * The registry (shared/types/lexicon.ts) points AT owning files; it never re-declares
 * a union. See docs/rules/lexicon.md for the full contract.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  LEXICON,
  DUPLICATE_NAME_ALLOWLIST,
  isValidLexiconTicket,
  type LexiconEntry,
  type DuplicateNameAllowEntry,
} from '../shared/types/lexicon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_GLOSSARY_PATH = path.resolve(ROOT, 'GLOSSARY.md');

// Directories scanned for the live duplicate-exported-name census.
// Exported so a boundary test can pin the scan surface (an accidental change here
// silently widens/narrows what the collision rule covers).
export const SCAN_ROOTS = ['shared/types', 'server'] as const;

// ── Term normalization (registry term ↔ GLOSSARY bold label) ─────────────────

/**
 * Normalize a term for parity comparison. GLOSSARY writes some terms with
 * surrounding backticks (`` `buildSystemPrompt()` ``); the registry stores the
 * plain form. Strip backticks and collapse whitespace so both sides align.
 */
export function normalizeTerm(raw: string): string {
  return raw.replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Extract the bold term at the start of each GLOSSARY definition paragraph.
 * GLOSSARY entries look like: `**Term** — definition`. Only a bold span that
 * begins a line (optionally after list markers) counts as a term declaration.
 */
export function extractGlossaryTerms(glossaryContent: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const lines = glossaryContent.split('\n');
  for (const line of lines) {
    // Term line: starts with optional whitespace, then **...**, then an em-dash/hyphen separator.
    const match = line.match(/^\s*\*\*(.+?)\*\*\s*(?:—|–|-)\s+/);
    if (!match) continue;
    const term = normalizeTerm(match[1]);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

// ── Duplicate exported-name census ───────────────────────────────────────────

export interface DuplicateNameScanInput {
  path: string;
  source: string;
}

export interface DuplicateNameHit {
  name: string;
  files: string[];
}

/**
 * Blank out `/* … *\/` block comments and backtick template-literal bodies so a
 * line-start `export type X` / `export interface X` *inside* a block comment or a
 * template string is not counted as a real declaration (false-positive avoidance
 * for the anchored scan). Newlines are preserved (so line anchoring elsewhere is
 * unaffected) and the removed text is replaced with spaces of equal length.
 *
 * Not stripped: line comments (`// export type X` fails the `^export` anchor
 * anyway since the `//` precedes `export`) and single/double-quoted strings (a
 * TS type/interface declaration cannot appear inside one on a single physical line
 * in a way that would satisfy the anchor). This is a deliberately conservative
 * blank-out, not a full tokenizer.
 */
export function stripBlockCommentsAndTemplateLiterals(source: string): string {
  // Replace each matched region with the same number of characters, preserving
  // newlines, so byte/line offsets are stable and `^`-anchored matches elsewhere
  // are untouched.
  const blankPreservingNewlines = (chunk: string): string =>
    chunk.replace(/[^\n]/g, ' ');

  // Block comments first, then template literals. Both are non-greedy and span lines.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blankPreservingNewlines)
    .replace(/`[\s\S]*?`/g, blankPreservingNewlines);
}

/**
 * Scan sources for top-level `export type|interface NAME` declarations and return
 * the names declared in 2+ distinct files. Declaration-only (anchored at the line
 * start): re-exports (`export type * from`, `export type { X }`) and indented
 * (non-top-level) declarations do NOT count. Block comments and template-literal
 * bodies are blanked out first (see `stripBlockCommentsAndTemplateLiterals`) so a
 * commented-out or string-embedded `export type X` is never a false positive.
 */
export function scanDuplicateExportedNames(files: DuplicateNameScanInput[]): DuplicateNameHit[] {
  const declByName = new Map<string, Set<string>>();
  // Anchored at line start (^): a leading space fails the match, excluding indented
  // (nested) declarations. `export type NAME =` and `export interface NAME` match;
  // `export type * from` / `export type { X }` do NOT (the name capture requires an
  // identifier immediately after the keyword, and `{`/`*` are not identifier chars).
  const declRegex = /^export\s+(?:type|interface)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm;

  for (const file of files) {
    const scannable = stripBlockCommentsAndTemplateLiterals(file.source);
    for (const match of scannable.matchAll(declRegex)) {
      const name = match[1];
      let set = declByName.get(name);
      if (!set) {
        set = new Set<string>();
        declByName.set(name, set);
      }
      set.add(file.path);
    }
  }

  const hits: DuplicateNameHit[] = [];
  for (const [name, fileSet] of declByName) {
    if (fileSet.size >= 2) {
      hits.push({ name, files: Array.from(fileSet).sort() });
    }
  }
  hits.sort((a, b) => a.name.localeCompare(b.name));
  return hits;
}

// ── Report builder (pure) ────────────────────────────────────────────────────

export interface LexiconRegistryReportInput {
  lexicon: readonly LexiconEntry[];
  allowlist: readonly DuplicateNameAllowEntry[];
  glossaryContent: string;
  /** Live duplicate-name scan result. Omit to skip check (b). */
  duplicateScan?: DuplicateNameHit[];
}

export interface LexiconRegistryReport {
  generatedBy: 'scripts/lexicon-registry.ts';
  totalRegistryEntries: number;
  totalGlossaryTerms: number;
  allowlistSize: number;
  registryTermsMissingFromGlossary: string[];
  glossaryTermsMissingFromRegistry: string[];
  allowlistEntriesMissingResolvingTicket: string[];
  /** Allowlist entries whose resolvingTicket does not match LEXICON_TICKET_PATTERN. */
  allowlistEntriesWithInvalidTicket: string[];
  /** Proposed lexicon terms missing a resolvingTicket (doc requires one). */
  proposedEntriesMissingResolvingTicket: string[];
  /** Proposed lexicon terms whose resolvingTicket does not match the pattern. */
  proposedEntriesWithInvalidTicket: string[];
  unregisteredDuplicateNames: DuplicateNameHit[];
  pass: boolean;
}

export function buildLexiconRegistryReport(input: LexiconRegistryReportInput): LexiconRegistryReport {
  const { lexicon, allowlist, glossaryContent, duplicateScan } = input;

  const registryTerms = new Set(lexicon.map(e => normalizeTerm(e.term)));
  const glossaryTerms = new Set(extractGlossaryTerms(glossaryContent));

  const registryTermsMissingFromGlossary = Array.from(registryTerms)
    .filter(term => !glossaryTerms.has(term))
    .sort();
  const glossaryTermsMissingFromRegistry = Array.from(glossaryTerms)
    .filter(term => !registryTerms.has(term))
    .sort();

  const hasTicket = (ticket: string | undefined): ticket is string =>
    !!ticket && ticket.trim() !== '';

  const allowlistEntriesMissingResolvingTicket = allowlist
    .filter(entry => !hasTicket(entry.resolvingTicket))
    .map(entry => entry.name)
    .sort();

  // Ticket-shape enforcement (allowlist): a present-but-malformed ticket
  // ('permanant', 'R2x', 'reconcile-2') must fail. Missing tickets are reported
  // by the check above, so only validate tickets that ARE present here.
  const allowlistEntriesWithInvalidTicket = allowlist
    .filter(entry => hasTicket(entry.resolvingTicket) && !isValidLexiconTicket(entry.resolvingTicket))
    .map(entry => entry.name)
    .sort();

  // Proposed lexicon terms must carry a resolvingTicket (doc contract) with a valid shape.
  const proposedEntries = lexicon.filter(entry => entry.wordClass === 'proposed');
  const proposedEntriesMissingResolvingTicket = proposedEntries
    .filter(entry => !hasTicket(entry.resolvingTicket))
    .map(entry => entry.term)
    .sort();
  const proposedEntriesWithInvalidTicket = proposedEntries
    .filter(entry => hasTicket(entry.resolvingTicket) && !isValidLexiconTicket(entry.resolvingTicket))
    .map(entry => entry.term)
    .sort();

  const allowlistNames = new Set(allowlist.map(entry => entry.name));
  const unregisteredDuplicateNames = (duplicateScan ?? [])
    .filter(hit => !allowlistNames.has(hit.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const pass =
    registryTermsMissingFromGlossary.length === 0 &&
    glossaryTermsMissingFromRegistry.length === 0 &&
    allowlistEntriesMissingResolvingTicket.length === 0 &&
    allowlistEntriesWithInvalidTicket.length === 0 &&
    proposedEntriesMissingResolvingTicket.length === 0 &&
    proposedEntriesWithInvalidTicket.length === 0 &&
    unregisteredDuplicateNames.length === 0;

  return {
    generatedBy: 'scripts/lexicon-registry.ts',
    totalRegistryEntries: lexicon.length,
    totalGlossaryTerms: glossaryTerms.size,
    allowlistSize: allowlist.length,
    registryTermsMissingFromGlossary,
    glossaryTermsMissingFromRegistry,
    allowlistEntriesMissingResolvingTicket,
    allowlistEntriesWithInvalidTicket,
    proposedEntriesMissingResolvingTicket,
    proposedEntriesWithInvalidTicket,
    unregisteredDuplicateNames,
    pass,
  };
}

export function formatLexiconRegistryReportMarkdown(report: LexiconRegistryReport): string {
  const lines: string[] = [];
  lines.push('# Lexicon Registry Report');
  lines.push('');
  lines.push(`Result: ${report.pass ? 'PASS' : 'FAIL'}`);
  lines.push(`- Registry entries: ${report.totalRegistryEntries}`);
  lines.push(`- GLOSSARY terms: ${report.totalGlossaryTerms}`);
  lines.push(`- Duplicate-name allowlist size: ${report.allowlistSize}`);
  lines.push('');

  const sections: Array<[string, string[]]> = [
    ['Registry terms missing from GLOSSARY.md', report.registryTermsMissingFromGlossary],
    ['GLOSSARY.md terms missing from registry', report.glossaryTermsMissingFromRegistry],
    ['Allowlist entries missing resolvingTicket', report.allowlistEntriesMissingResolvingTicket],
    ['Allowlist entries with invalid resolvingTicket', report.allowlistEntriesWithInvalidTicket],
    ['Proposed terms missing resolvingTicket', report.proposedEntriesMissingResolvingTicket],
    ['Proposed terms with invalid resolvingTicket', report.proposedEntriesWithInvalidTicket],
  ];
  for (const [title, values] of sections) {
    lines.push(`## ${title}`);
    if (values.length === 0) {
      lines.push('- none');
    } else {
      for (const value of values) lines.push(`- ${value}`);
    }
    lines.push('');
  }

  lines.push('## Unregistered duplicate exported type names');
  if (report.unregisteredDuplicateNames.length === 0) {
    lines.push('- none');
  } else {
    for (const hit of report.unregisteredDuplicateNames) {
      lines.push(`- \`${hit.name}\` (${hit.files.join(', ')})`);
    }
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

// ── Live file collection (CLI only) ──────────────────────────────────────────

function collectTsFiles(dir: string): DuplicateNameScanInput[] {
  const results: DuplicateNameScanInput[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    results.push({
      path: path.relative(ROOT, full),
      source: fs.readFileSync(full, 'utf8'),
    });
  }
  return results;
}

export function collectDuplicateScanFromDisk(rootDir: string = ROOT): DuplicateNameHit[] {
  const files: DuplicateNameScanInput[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    files.push(...collectTsFiles(path.resolve(rootDir, scanRoot)));
  }
  return scanDuplicateExportedNames(files);
}

interface CliOptions {
  glossaryPath: string;
  json: boolean;
  help: boolean;
}

export function parseCliArgs(args: string[]): CliOptions | null {
  let glossaryPath = DEFAULT_GLOSSARY_PATH;
  let json = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--glossary') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        console.error('Missing value for --glossary.');
        return null;
      }
      glossaryPath = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    return null;
  }

  return { glossaryPath, json, help };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv);
  if (!options || options.help) {
    console.error('Usage: npm run verify:lexicon -- [--glossary path] [--json]');
    process.exit(options?.help ? 0 : 1);
    return;
  }

  const glossaryContent = fs.readFileSync(options.glossaryPath, 'utf8');
  const duplicateScan = collectDuplicateScanFromDisk();
  const report = buildLexiconRegistryReport({
    lexicon: LEXICON,
    allowlist: DUPLICATE_NAME_ALLOWLIST,
    glossaryContent,
    duplicateScan,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatLexiconRegistryReportMarkdown(report));
  }

  if (!report.pass) {
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  void main();
}
