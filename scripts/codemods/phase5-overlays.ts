#!/usr/bin/env tsx
/**
 * Phase 5 · Task 1.6 codemod scaffold — Overlay primitives.
 *
 * Usage:
 *   npx tsx scripts/codemods/phase5-overlays.ts             # dry-run (default)
 *   npx tsx scripts/codemods/phase5-overlays.ts --write     # write mode (no auto-transforms yet)
 *   npx tsx scripts/codemods/phase5-overlays.ts src/components/admin  # scope to a subdir
 *
 * Identifies hand-rolled modal/overlay patterns and emits a per-file migration
 * worksheet. Modals are never auto-rewritten: each one has custom header/body/
 * footer structure and onClose wiring that requires a human to partition it
 * into `<Modal.Header>` / `<Modal.Body>` / `<Modal.Footer>`.
 *
 * Output is plain text on stdout. Pipe to a file to capture:
 *   npx tsx scripts/codemods/phase5-overlays.ts > /tmp/phase5-overlays-worksheet.txt
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';

interface Hit {
  file: string;
  line: number;
  text: string;
  pattern: string;
  suggestion: string;
}

const PATTERNS: Array<{
  name: string;
  regex: RegExp;
  suggestion: string;
}> = [
  {
    // `<div className="fixed inset-0 ...">` — common hand-rolled modal backdrop
    name: 'fixed-inset-0-overlay',
    regex: /className\s*=\s*["'`][^"'`]*\bfixed\b[^"'`]*\binset-0\b[^"'`]*["'`]/,
    suggestion:
      'Likely a hand-rolled modal backdrop. Replace with <Modal open onClose>...</Modal>. Identify the header (title + close button) → <Modal.Header title onClose>; body content → <Modal.Body>; action row → <Modal.Footer>.',
  },
  {
    // `{isOpen && <div className="fixed ...">` — conditional modal shell
    name: 'conditional-modal-shell',
    regex: /\{\s*\w*(?:Open|Visible|Show|show)\w*\s*&&\s*<div[^>]*className\s*=\s*["'`][^"'`]*\bfixed\b/,
    suggestion:
      'Conditional fixed-overlay — migrate to <Modal open={isOpen} onClose={...}>. Ensure the close trigger (the X button, cancel button, backdrop click) calls the same handler.',
  },
  {
    // Hand-rolled dropdown menu (absolute + bg-zinc)
    name: 'absolute-dropdown-shell',
    regex: /className\s*=\s*["'`][^"'`]*\babsolute\b[^"'`]*\bbg-zinc-9\d{2}[^"'`]*["'`]/,
    suggestion:
      'Possible hand-rolled dropdown/popover. Consider migrating to <Popover trigger={...}> with <Popover.Item> children. Outside-click, Escape, and keyboard navigation come for free.',
  },
  {
    // Ad-hoc tooltip (title attr inside JSX)
    name: 'raw-title-attr-on-interactive',
    regex: /<(?:button|a)\b[^>]*\btitle\s*=\s*["'`][^"'`]{4,}["'`]/,
    suggestion:
      'A native `title` tooltip is not keyboard- or screen-reader-accessible on mobile/desktop uniformly. Consider wrapping with <Tooltip content="..."> for a consistent, ARIA-correct affordance.',
  },
];

const DEFAULT_GLOB = ['src/**/*.tsx'];
const DEFAULT_IGNORE = [
  'src/components/ui/**',
  'src/**/*.test.tsx',
  'src/**/__tests__/**',
];

function parseArgs(): { write: boolean; paths: string[] } {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const paths = argv.filter((a) => !a.startsWith('--'));
  return { write, paths };
}

function resolveGlobs(paths: string[]): string[] {
  if (paths.length === 0) {
    return globSync(DEFAULT_GLOB, { nodir: true, ignore: DEFAULT_IGNORE });
  }
  const hits: string[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (abs.endsWith('.tsx')) {
      hits.push(p);
    } else {
      hits.push(
        ...globSync(`${p}/**/*.tsx`, {
          nodir: true,
          ignore: [`${p}/**/*.test.tsx`, `${p}/**/__tests__/**`],
        }),
      );
    }
  }
  return Array.from(new Set(hits));
}

function scan(files: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const p of PATTERNS) {
        if (p.regex.test(line)) {
          hits.push({
            file,
            line: i + 1,
            text: line.trim().slice(0, 200),
            pattern: p.name,
            suggestion: p.suggestion,
          });
        }
      }
    }
  }
  return hits;
}

function printReport(hits: Hit[], write: boolean): void {
  const byFile = new Map<string, Hit[]>();
  for (const hit of hits) {
    const arr = byFile.get(hit.file) ?? [];
    arr.push(hit);
    byFile.set(hit.file, arr);
  }

  console.log('Phase 5 · Overlay primitives — migration worksheet');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(`Mode: ${write ? 'WRITE (no transforms applied — manual review required)' : 'DRY-RUN'}`);
  console.log(`Files scanned: ${byFile.size}`);
  console.log(`Total matches: ${hits.length}`);
  console.log('');

  if (hits.length === 0) {
    console.log('No hand-rolled overlay patterns detected.');
    return;
  }

  const sortedFiles = Array.from(byFile.keys()).sort();
  for (const file of sortedFiles) {
    const fileHits = byFile.get(file)!;
    console.log(`── ${file} (${fileHits.length} match${fileHits.length === 1 ? '' : 'es'})`);
    for (const h of fileHits) {
      console.log(`   L${h.line}  [${h.pattern}]`);
      console.log(`           ${h.text}`);
      console.log(`     → ${h.suggestion}`);
    }
    console.log('');
  }

  const byPattern = new Map<string, number>();
  for (const hit of hits) byPattern.set(hit.pattern, (byPattern.get(hit.pattern) ?? 0) + 1);
  console.log('Summary by pattern:');
  for (const [name, count] of byPattern.entries()) {
    console.log(`  ${name.padEnd(32)} ${count}`);
  }
  console.log('');
  console.log(
    'NOTE: Overlays are not auto-transformed. Modal migrations require identifying header/body/footer regions and the close handler. Dropdown migrations need trigger/menu partitioning.',
  );
}

function main(): void {
  const { write, paths } = parseArgs();
  const files = resolveGlobs(paths);
  const hits = scan(files);
  printReport(hits, write);
  // Exit with 0 regardless — this scaffold is informational-only in Phase 1.
}

// Only execute when invoked directly (not when imported). Without this guard,
// any module that ends up importing this file would trigger a filesystem scan.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
