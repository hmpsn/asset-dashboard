// tests/unit/outcome-attribution-required-guard.test.ts
// R8-PR2 (B14): count-based guard — NO internal (production) recordAction() call site may
// omit `attribution`. The inverted `?? 'platform_executed'` default was removed as a trust
// hazard (it silently over-credited the platform), and TypeScript now requires the param at
// compile time. This structural test is the belt-and-braces backstop: it fails loudly if a
// future producer reintroduces an attribution-less call (which, if it slipped past the
// compiler via an `as any` cast, would throw at the INSERT — the stmt binds `@attribution`
// unconditionally and better-sqlite3 rejects an `undefined` binding). Every call must pass an
// explicit, honest attribution — the value that is ACTUALLY TRUE for its path.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs'; // readFile-ok — structural guard reads server source to verify every recordAction call passes attribution
import { execSync } from 'child_process';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../..');

/**
 * Every production (non-test) file under server/ that contains a recordAction( call.
 * Tests, __tests__, and the outcome-tracking module's own definition are structural noise;
 * we scan callers, and the definition file's single self-referencing bridge call is included
 * because it IS a real internal call site that must pass attribution.
 */
function productionRecordActionFiles(): string[] {
  const out = execSync(
    `grep -rl "recordAction(" server --include="*.ts" || true`,
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(f => !f.includes('__tests__') && !f.endsWith('.test.ts'));
}

/**
 * Given file source, return the 1-based line numbers of every `recordAction({ ... })` object-
 * literal call whose top-level object does NOT contain an `attribution` key (colon form or
 * shorthand `attribution,`). Uses brace-depth matching from the opening `{` after the call.
 */
function callsMissingAttribution(src: string): number[] {
  const lines = src.split('\n');
  const missing: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const callMatch = /recordAction\s*\(\s*\{/.exec(lines[i]);
    if (!callMatch) continue;

    const startCol = lines[i].indexOf('{', callMatch.index);
    let depth = 0;
    let started = false;
    let endLine = i;

    outer:
    for (let j = i; j < lines.length; j++) {
      const scanStart = j === i ? startCol : 0;
      const s = lines[j];
      for (let k = scanStart; k < s.length; k++) {
        const ch = s[k];
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') {
          depth--;
          if (started && depth === 0) { endLine = j; break outer; }
        }
      }
    }

    const block = lines.slice(i, endLine + 1).join('\n');
    const hasColon = /\battribution\s*:/.test(block);
    const hasShorthand = /(^|[{,\s])attribution\s*,/m.test(block);
    if (!hasColon && !hasShorthand) missing.push(i + 1);
  }

  return missing;
}

describe('B14: every production recordAction() call passes attribution', () => {
  const files = productionRecordActionFiles();

  it('finds production recordAction call sites (guard is actually scanning something)', () => {
    // Sanity: if this drops to 0, the grep/scan broke and the guard below is vacuously green.
    expect(files.length).toBeGreaterThan(5);
  });

  it('has ZERO production recordAction calls that omit attribution', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(resolve(REPO_ROOT, file), 'utf8');
      for (const line of callsMissingAttribution(src)) {
        offenders.push(`${file}:${line}`);
      }
    }
    // A non-empty list means a caller reintroduced the removed inverted default (a trust
    // hazard) — it must pass the attribution that is true for its path instead.
    expect(offenders).toEqual([]);
  });
});
