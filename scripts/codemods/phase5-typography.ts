/**
 * phase5-typography.ts — Design System Phase 5 · Task 1.1 codemod scaffold
 *
 * Finds hand-rolled typography patterns in src/ and reports candidates for
 * replacement with the new <Heading>, <Stat>, <BodyText>, <Caption>, <Label>,
 * and <Mono> primitives.
 *
 * DEFAULT: --dry-run (no files written)
 * OPT-IN:  --write  (applies transformations — review dry-run output first)
 *
 * Usage:
 *   npx tsx scripts/codemods/phase5-typography.ts
 *   npx tsx scripts/codemods/phase5-typography.ts --write
 */

import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';
import { relative } from 'path';

const WRITE = process.argv.includes('--write');
const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');

// ─── Pattern registry ────────────────────────────────────────────────────────

interface Pattern {
  name: string;
  description: string;
  regex: RegExp;
  replacement: string;
}

const PATTERNS: Pattern[] = [
  {
    name: 'label-span',
    description: '<span className="text-[11px] uppercase tracking-wide text-zinc-500"> → <Label>',
    // Matches: <span className="text-[11px] uppercase tracking-wide text-zinc-500">...</span>
    regex: /<span\s+className="[^"]*text-\[11px\][^"]*uppercase[^"]*tracking-wide[^"]*text-zinc-500[^"]*">([^<]*)<\/span>/g,
    replacement: '<Label>$1</Label>',
  },
  {
    name: 'label-span-alt',
    description: '<span className="...uppercase tracking-wider text-zinc-500..."> → <Label>',
    // Broader: any span with uppercase + tracking-wider + text-zinc-500
    regex: /<span\s+className="[^"]*uppercase[^"]*tracking-wider[^"]*text-zinc-500[^"]*">([^<]*)<\/span>/g,
    replacement: '<Label>$1</Label>',
  },
  {
    name: 'stat-hero-div',
    description: '<div className="text-3xl font-bold"> → <Stat size="hero">',
    regex: /<div\s+className="text-3xl font-bold">([^<]*)<\/div>/g,
    replacement: '<Stat size="hero">$1</Stat>',
  },
  {
    name: 'stat-default-div',
    description: '<div className="text-2xl font-bold"> → <Stat size="default">',
    regex: /<div\s+className="text-2xl font-bold">([^<]*)<\/div>/g,
    replacement: '<Stat size="default">$1</Stat>',
  },
  {
    name: 'stat-sm-div',
    description: '<div className="text-xl font-bold"> → <Stat size="sm">',
    regex: /<div\s+className="text-xl font-bold">([^<]*)<\/div>/g,
    replacement: '<Stat size="sm">$1</Stat>',
  },
  {
    name: 'caption-p',
    description: '<p className="text-xs text-zinc-500"> → <Caption>',
    regex: /<p\s+className="text-xs text-zinc-500">([^<]*)<\/p>/g,
    replacement: '<Caption>$1</Caption>',
  },
  {
    name: 'caption-sm-p',
    description: '<p className="text-[11px] text-zinc-500"> → <Caption size="sm">',
    regex: /<p\s+className="text-\[11px\] text-zinc-500">([^<]*)<\/p>/g,
    replacement: '<Caption size="sm">$1</Caption>',
  },
  {
    name: 'caption-span',
    description: '<span className="text-xs text-zinc-500"> → <Caption>',
    regex: /<span\s+className="text-xs text-zinc-500">([^<]*)<\/span>/g,
    replacement: '<Caption>$1</Caption>',
  },
  {
    name: 'body-p',
    description: '<p className="text-sm ...text-zinc-400..."> → <BodyText>',
    regex: /<p\s+className="text-sm text-zinc-400">([^<]*)<\/p>/g,
    replacement: '<BodyText>$1</BodyText>',
  },
  {
    name: 'heading-h1',
    description: '<h1 className="text-2xl font-bold"> → <Heading level={1}>',
    regex: /<h1\s+className="text-2xl font-bold">([^<]*)<\/h1>/g,
    replacement: '<Heading level={1}>$1</Heading>',
  },
  {
    name: 'heading-h2',
    description: '<h2 className="text-xl font-semibold"> → <Heading level={2}>',
    regex: /<h2\s+className="text-xl font-semibold">([^<]*)<\/h2>/g,
    replacement: '<Heading level={2}>$1</Heading>',
  },
];

// ─── File scanning ────────────────────────────────────────────────────────────

interface FileMatch {
  file: string;
  matches: { pattern: string; count: number; lines: number[] }[];
  totalMatches: number;
}

function scanFile(filePath: string): FileMatch | null {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = content.split('\n');
  const fileMatches: FileMatch['matches'] = [];

  for (const pattern of PATTERNS) {
    const matchedLines: number[] = [];
    let count = 0;

    lines.forEach((line, idx) => {
      const localRegex = new RegExp(pattern.regex.source, 'g');
      const hits = line.match(localRegex);
      if (hits) {
        count += hits.length;
        matchedLines.push(idx + 1); // 1-based
      }
    });

    if (count > 0) {
      fileMatches.push({ pattern: pattern.name, count, lines: matchedLines });
    }
  }

  if (fileMatches.length === 0) return null;

  return {
    file: relative(ROOT, filePath),
    matches: fileMatches,
    totalMatches: fileMatches.reduce((sum, m) => sum + m.count, 0),
  };
}

function applyTransforms(filePath: string): number {
  let content = readFileSync(filePath, 'utf-8');
  let totalReplaced = 0;

  for (const pattern of PATTERNS) {
    const before = content;
    content = content.replace(pattern.regex, pattern.replacement);
    // Count replacements by comparing
    const replaced = (before.match(new RegExp(pattern.regex.source, 'g')) ?? []).length;
    totalReplaced += replaced;
  }

  if (totalReplaced > 0) {
    writeFileSync(filePath, content, 'utf-8');
  }

  return totalReplaced;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const files = globSync('src/**/*.tsx', { cwd: ROOT, absolute: true });

  console.log(`\nphase5-typography codemod — ${WRITE ? 'WRITE MODE' : 'DRY RUN'}`);
  console.log(`Scanning ${files.length} .tsx files in src/\n`);

  const results: FileMatch[] = [];

  for (const file of files) {
    const result = scanFile(file);
    if (result) results.push(result);
  }

  // Sort by match count descending
  results.sort((a, b) => b.totalMatches - a.totalMatches);

  const totalMatches = results.reduce((sum, r) => sum + r.totalMatches, 0);

  if (totalMatches === 0) {
    console.log('No matching patterns found.');
    return;
  }

  // Per-file match report
  console.log('Per-file match report:');
  console.log('─'.repeat(72));
  for (const result of results) {
    console.log(`\n  ${result.file} (${result.totalMatches} match${result.totalMatches !== 1 ? 'es' : ''})`);
    for (const m of result.matches) {
      const lineList = m.lines.slice(0, 5).join(', ') + (m.lines.length > 5 ? '…' : '');
      console.log(`    [${m.pattern}] ×${m.count} — lines: ${lineList}`);
    }
  }

  console.log('\n' + '─'.repeat(72));
  console.log(`Total matches: ${totalMatches} across ${results.length} file${results.length !== 1 ? 's' : ''}`);

  // Top-10 by match count
  console.log('\nTop 10 files by match count:');
  results.slice(0, 10).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.file} — ${r.totalMatches} matches`);
  });

  if (WRITE) {
    console.log('\nApplying transforms...');
    let writtenFiles = 0;
    let totalReplaced = 0;
    for (const result of results) {
      const replaced = applyTransforms(`${ROOT}/${result.file}`);
      if (replaced > 0) {
        writtenFiles++;
        totalReplaced += replaced;
        console.log(`  wrote ${result.file} (${replaced} replacement${replaced !== 1 ? 's' : ''})`);
      }
    }
    console.log(`\nDone. ${totalReplaced} replacement${totalReplaced !== 1 ? 's' : ''} in ${writtenFiles} file${writtenFiles !== 1 ? 's' : ''}.`);
    console.log('Next: run `npm run typecheck` and review diffs before committing.');
  } else {
    console.log('\nDRY RUN complete — no files written.');
    console.log('Re-run with --write to apply transforms.');
  }
}

main();
