#!/usr/bin/env tsx
/**
 * scripts/codemods/phase5-buttons.ts
 *
 * Dry-run codemod scanner for Phase 5 Task 1.3 — finds candidate
 * hand-rolled <button> elements that should migrate to <Button>,
 * <IconButton>, or <ActionPill> primitives.
 *
 * Default: --dry-run (only report). Pass --write to (eventually) apply,
 * but writes are NOT implemented in this scaffold.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const SRC = resolve(root, 'src');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');

interface Match {
  file: string;
  line: number;
  category: string;
  snippet: string;
}

const matches: Match[] = [];

const PATTERNS: Array<{ category: string; re: RegExp }> = [
  // Primary button — teal→emerald gradient
  {
    category: 'Button variant=primary (gradient)',
    re: /<button[^>]*from-teal-600[^>]*to-emerald-600[^>]*>/g,
  },
  // Secondary button — zinc chrome
  {
    category: 'Button variant=secondary (zinc-800 chrome)',
    re: /<button[^>]*bg-zinc-800[^>]*hover:bg-zinc-700[^>]*>/g,
  },
  // Danger button — red bg
  {
    category: 'Button variant=danger (red-600)',
    re: /<button[^>]*bg-red-(?:500|600)[^>]*>/g,
  },
  // ActionPill — emerald approve pill
  {
    category: 'ActionPill variant=approve (emerald)',
    re: /<button[^>]*border-emerald-500\/30[^>]*bg-emerald-500\/10[^>]*>/g,
  },
  // ActionPill — red decline pill
  {
    category: 'ActionPill variant=decline (red)',
    re: /<button[^>]*border-red-500\/30[^>]*bg-red-500\/10[^>]*>/g,
  },
  // ActionPill — teal start pill
  {
    category: 'ActionPill variant=start (teal)',
    re: /<button[^>]*border-teal-500\/30[^>]*bg-teal-500\/10[^>]*>/g,
  },
  // ActionPill — blue send pill
  {
    category: 'ActionPill variant=send (blue)',
    re: /<button[^>]*border-blue-500\/30[^>]*bg-blue-500\/10[^>]*>/g,
  },
  // ActionPill — amber request-changes pill
  {
    category: 'ActionPill variant=request-changes (amber)',
    re: /<button[^>]*border-amber-500\/30[^>]*bg-amber-500\/10[^>]*>/g,
  },
];

// Icon-only button — needs human review for label text (a11y)
const ICON_ONLY_RE =
  /<button[^>]*>\s*<(?:[A-Z]\w+)[^>]*\/>\s*<\/button>/g;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      yield* walk(full);
    } else if (full.endsWith('.tsx')) {
      yield full;
    }
  }
}

for (const file of walk(SRC)) {
  // Skip the primitives themselves
  if (
    file.endsWith('Button.tsx') ||
    file.endsWith('IconButton.tsx') ||
    file.endsWith('ActionPill.tsx') ||
    file.endsWith('SegmentedControl.tsx')
  ) {
    continue;
  }
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  for (const { category, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const line = before.split('\n').length;
      matches.push({
        file: relative(root, file),
        line,
        category,
        snippet: lines[line - 1].trim().slice(0, 140),
      });
    }
  }

  ICON_ONLY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ICON_ONLY_RE.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    const line = before.split('\n').length;
    matches.push({
      file: relative(root, file),
      line,
      category: 'IconButton candidate (manual review — needs a11y label)',
      snippet: lines[line - 1].trim().slice(0, 140),
    });
  }
}

// Group + report
const byCategory = new Map<string, Match[]>();
for (const m of matches) {
  if (!byCategory.has(m.category)) byCategory.set(m.category, []);
  byCategory.get(m.category)!.push(m);
}

console.log(`\nPhase 5 Task 1.3 — Button codemod (dry-run)\n${'='.repeat(60)}`);
console.log(`Total matches: ${matches.length}`);
console.log(`Files affected: ${new Set(matches.map((m) => m.file)).size}\n`);

for (const [cat, ms] of [...byCategory.entries()].sort(
  (a, b) => b[1].length - a[1].length,
)) {
  console.log(`\n${cat} — ${ms.length} match(es)`);
  console.log('-'.repeat(60));
  const byFile = new Map<string, number>();
  for (const m of ms) {
    byFile.set(m.file, (byFile.get(m.file) || 0) + 1);
  }
  const top = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [f, n] of top) {
    console.log(`  ${n.toString().padStart(3)}  ${f}`);
  }
}

if (WRITE) {
  console.log('\n--write flag passed but auto-rewriting is NOT IMPLEMENTED.');
  console.log('Each match needs human review for: a11y labels, loading state,');
  console.log('icon prop, onClick wiring. Use this report as a manual checklist.');
  process.exit(1);
}

console.log(`\n(Dry-run only. Use --write to attempt rewrites — not implemented yet.)\n`);
