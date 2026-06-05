/**
 * route-fold-in-seo-ranks.test.ts — Phase P4-T4 drift safety net.
 *
 * After the Rank Tracker fold-in, the ONLY place that resolves `seo-ranks` to
 * a destination is the App.tsx redirect (flag-ON -> seo-keywords) / the
 * standalone RankTracker (flag-OFF). No other src/ component may navigate TO
 * `seo-ranks` via the literal `navigate(adminPath(_, 'seo-ranks'))` form —
 * such a navigator would bypass the Hub when the flag is on.
 *
 * readFile-ok — this test intentionally reads source files for static analysis.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '../..');
const SRC_DIR = join(ROOT, 'src');

/** Files allowed to reference seo-ranks routing: the redirect + the retained label. */
const ALLOWED = new Set([
  'src/App.tsx',                          // the flag-gated <Navigate> redirect + the flag-OFF RankTracker render
  'src/routes.ts',                        // the Page union value (retained for P5)
  'src/components/layout/Breadcrumbs.tsx', // the retained "Rank Tracker" crumb label
]);

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// Matches a direct navigate-to-seo-ranks call: navigate(adminPath(<anything>, 'seo-ranks'))
const NAVIGATE_SEO_RANKS = /navigate\(\s*adminPath\([^,]+,\s*['"]seo-ranks['"]\s*\)/;

describe('route-fold-in: no src/ component navigates directly to seo-ranks', () => {
  it('no file outside the allow-list contains navigate(adminPath(_, "seo-ranks"))', () => {
    const offenders: string[] = [];
    for (const file of collectFiles(SRC_DIR)) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (ALLOWED.has(rel)) continue;
      const content = readFileSync(file, 'utf8'); // readFile-ok — static analysis
      if (NAVIGATE_SEO_RANKS.test(content)) offenders.push(rel);
    }
    expect(offenders, `These files navigate directly to seo-ranks (should route to seo-keywords / be flag-gated):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the allow-list files exist (sanity)', () => {
    for (const rel of ALLOWED) {
      expect(() => statSync(join(ROOT, rel)), `${rel} should exist`).not.toThrow();
    }
  });
});
