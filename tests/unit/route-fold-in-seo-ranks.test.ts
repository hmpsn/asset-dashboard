/**
 * route-fold-in-seo-ranks.test.ts — route-retired guard (W4 Phase C1 + D).
 *
 * The standalone Rank Tracker and its `seo-ranks` route were fully removed in
 * the Keyword Hub cutover: the Page-union value, the App.tsx redirect, the nav
 * registry entry, and every navigator are gone. This test is the drift safety
 * net — NOTHING under src/ may reference `seo-ranks` (as a route literal or a
 * navigate target) anymore. The allow-list is intentionally empty.
 *
 * readFile-ok — this test intentionally reads source files for static analysis.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '../..');
const SRC_DIR = join(ROOT, 'src');

/** Files allowed to reference seo-ranks. Intentionally empty: the route is retired. */
const ALLOWED = new Set<string>([]);

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// Matches any reference to the retired seo-ranks route literal.
const SEO_RANKS_LITERAL = /['"]seo-ranks['"]/;

describe('route-retired: src/ no longer references the seo-ranks route', () => {
  it('no file outside the (empty) allow-list contains a seo-ranks route literal', () => {
    const offenders: string[] = [];
    for (const file of collectFiles(SRC_DIR)) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (ALLOWED.has(rel)) continue;
      const content = readFileSync(file, 'utf8'); // readFile-ok — static analysis
      if (SEO_RANKS_LITERAL.test(content)) offenders.push(rel);
    }
    expect(offenders, `These files still reference the retired seo-ranks route:\n${offenders.join('\n')}`).toEqual([]);
  });
});
