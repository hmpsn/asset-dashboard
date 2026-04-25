/**
 * Codemod scaffold: phase5-layout
 *
 * Dry-run scanner that identifies raw <div> flex/grid patterns eligible for
 * replacement with the Phase 5 layout primitives (Row, Stack, Divider).
 *
 * Usage:
 *   npx tsx scripts/codemods/phase5-layout.ts           # dry-run (default)
 *   npx tsx scripts/codemods/phase5-layout.ts --write   # NOT invoked automatically
 *
 * The --write flag is intentionally left as a no-op scaffold. Actual
 * transformation requires AST-level rewrites (jscodeshift / ts-morph) to
 * safely handle attribute order, multi-line JSX, and className merging.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// ─── Pattern definitions ───────────────────────────────────────────────────
//
// Gate 3 fix from phase-2-kickoff.md §1: patterns are now token-set based
// rather than exact-substring regex. The previous exact-match regexes missed
// real-world classNames like `flex items-center gap-2 justify-between`
// (additional classes beyond the minimum required for a Row migration).

interface Pattern {
  name: string;
  /** All tokens must be present in the className attribute to match. */
  tokens?: string[];
  /** Fallback for complex patterns that need regex (e.g. tag-level matches). */
  regex?: RegExp;
  replacement: string;
}

const PATTERNS: Pattern[] = [
  { name: 'Row gap="sm"',   tokens: ['flex', 'items-center', 'gap-2'], replacement: '<Row gap="sm">' },
  { name: 'Row gap="md"',   tokens: ['flex', 'items-center', 'gap-3'], replacement: '<Row gap="md">' },
  { name: 'Stack gap="md"', tokens: ['flex', 'flex-col', 'gap-3'],     replacement: '<Stack gap="md">' },
  { name: 'Stack gap="lg"', tokens: ['flex', 'flex-col', 'gap-4'],     replacement: '<Stack gap="lg">' },
  { name: 'Divider',        regex: /<hr\s+className="[^"]*\bborder-zinc-800\b[^"]*"/g, replacement: '<Divider />' },
];

/**
 * Check whether a line contains any className attribute whose token set
 * includes every required token. Additional Tailwind classes beyond the
 * required set are allowed (order-insensitive). Multiple className attrs on
 * the same line each get checked independently.
 */
function lineMatchesTokens(line: string, required: string[]): boolean {
  const classRe = /className\s*=\s*"([^"]*)"/g;
  let cm: RegExpExecArray | null;
  while ((cm = classRe.exec(line)) !== null) {
    const tokens = new Set(cm[1].split(/\s+/).filter(Boolean));
    if (required.every((t) => tokens.has(t))) return true;
  }
  return false;
}

// ─── File walker ───────────────────────────────────────────────────────────

function walkTsx(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      results.push(...walkTsx(full));
    } else if (entry.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

// ─── Match reporter ────────────────────────────────────────────────────────

interface FileMatches {
  file: string;
  matches: Array<{ pattern: string; line: number; text: string }>;
}

function scanFile(filePath: string): FileMatches {
  const src = readFileSync(filePath, 'utf-8');
  const lines = src.split('\n');
  const matches: FileMatches['matches'] = [];

  for (const pattern of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      let hit = false;
      if (pattern.tokens) {
        hit = lineMatchesTokens(lines[i], pattern.tokens);
      } else if (pattern.regex) {
        // Reset state since the regex is reused across lines.
        pattern.regex.lastIndex = 0;
        hit = pattern.regex.test(lines[i]);
      }
      if (hit) {
        matches.push({
          pattern: pattern.name,
          line: i + 1,
          text: lines[i].trim().slice(0, 120),
        });
      }
    }
  }

  return { file: filePath, matches };
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const isDryRun = !args.includes('--write');

  const srcDir = join(process.cwd(), 'src');
  const files = walkTsx(srcDir);

  let totalMatches = 0;
  const fileReports: FileMatches[] = [];

  for (const file of files) {
    const result = scanFile(file);
    if (result.matches.length > 0) {
      fileReports.push(result);
      totalMatches += result.matches.length;
    }
  }

  // ─── Report ─────────────────────────────────────────────────────────────

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Phase 5 Layout Codemod — Dry-run Report                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  if (fileReports.length === 0) {
    console.log('  No eligible patterns found. All clear!');
  } else {
    for (const report of fileReports) {
      console.log(`  ${relative(process.cwd(), report.file)}`);
      for (const m of report.matches) {
        console.log(`    L${m.line.toString().padStart(4, ' ')}  [${m.pattern}]  ${m.text}`);
      }
      console.log('');
    }
  }

  console.log('─'.repeat(66));
  console.log(`  Files scanned : ${files.length}`);
  console.log(`  Files matched : ${fileReports.length}`);
  console.log(`  Total matches : ${totalMatches}`);
  console.log('');

  if (isDryRun) {
    console.log('  Mode: DRY RUN. Pass --write to apply transforms (not yet implemented).');
  } else {
    console.log('  Mode: WRITE — AST transformation not yet implemented in this scaffold.');
    console.log('  Use jscodeshift or ts-morph for safe production rewrites.');
  }

  console.log('');
}

main();
