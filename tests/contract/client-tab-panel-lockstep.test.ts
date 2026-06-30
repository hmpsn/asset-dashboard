// tests/contract/client-tab-panel-lockstep.test.ts
//
// CONTRACT: KNOWN_CLIENT_TABS and the ClientDashboard `panels={{}}` keys must
// stay in lockstep.
//
// The Client IA v2 collapse (11 → 4 tabs) adds new ClientTab values
// (deep-dive / results / settings) across the union, KNOWN_CLIENT_TABS, the nav
// builder, and the panels map. If a future edit adds a known tab without a
// panel (or a panel without a known tab) the collapse silently drops a surface:
// resolveClientTab() routes the URL to a tab id that has no renderable panel,
// so the user lands on a blank screen.
//
// This test statically parses ClientDashboard.tsx's `panels={{ ... }}` object
// and asserts the key set equals KNOWN_CLIENT_TABS exactly. It does NOT exercise
// runtime behavior.
//
// NOTE: 'search' / 'analytics' are alias-only legacy surfaces that
// resolveClientTab redirects to 'performance'; they are intentionally NOT in
// KNOWN_CLIENT_TABS (and have no panel), so they are out of scope here.
//
// readFile-ok — this test intentionally reads source files for static analysis

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { KNOWN_CLIENT_TABS } from '../../src/lib/client-dashboard-tab';

const ROOT = join(__dirname, '../..');
const CLIENT_DASHBOARD = join(ROOT, 'src/components/ClientDashboard.tsx');

/**
 * Extract the `panels={{ ... }}` object literal from ClientDashboard.tsx by
 * brace-matching, then collect its top-level keys (the panel ids).
 *
 * Mirrors the brace-walk approach in tab-deep-link-wiring.test.ts so both
 * contracts read the panels block the same way.
 */
function extractPanelKeys(): string[] {
  const dashboard = readFileSync(CLIENT_DASHBOARD, 'utf8'); // readFile-ok — intentional static analysis of client panel map

  const marker = 'panels={{';
  const panelsStart = dashboard.indexOf(marker);
  if (panelsStart < 0) {
    throw new Error('Could not find `panels={{` in ClientDashboard.tsx');
  }

  // Walk from just after `panels={{` until the two opening braces close.
  let i = panelsStart + marker.length;
  let braceDepth = 2; // `panels={{` opens two braces
  const innerStart = i;
  let innerEnd = dashboard.length;
  while (i < dashboard.length && braceDepth > 0) {
    const ch = dashboard[i];
    if (ch === '{') braceDepth += 1;
    else if (ch === '}') {
      braceDepth -= 1;
      if (braceDepth === 1) {
        // Closing the inner object literal `{{ ... }` → record its end.
        innerEnd = i;
      }
    }
    i += 1;
  }

  const innerBlock = dashboard.slice(innerStart, innerEnd);

  // Collect top-level keys only — those that appear at depth 0 of the inner
  // object literal (each panel value is a JSX expression wrapped in `( ... )`,
  // which raises the depth so nested `prop:` / object keys are never counted).
  // Scan char-by-char tracking bracket depth; whenever we are at depth 0 and the
  // remaining text begins with a `key:` token, record it.
  const keys = new Set<string>();
  const keyAtPos = /^(?:'([a-z][a-z-]*)'|"([a-z][a-z-]*)"|([a-z][a-z-]*))\s*:/;
  let depth = 0;
  for (let p = 0; p < innerBlock.length; p++) {
    const ch = innerBlock[p];
    if (ch === '{' || ch === '(' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    // Only attempt a key match at the start of a token (after `,`/newline/`{`).
    const prev = p > 0 ? innerBlock[p - 1] : ',';
    if (prev !== ',' && prev !== '\n' && prev !== ' ' && prev !== '\t' && prev !== '{') continue;
    const m = keyAtPos.exec(innerBlock.slice(p));
    if (m) {
      const key = m[1] ?? m[2] ?? m[3];
      if (key) keys.add(key);
    }
  }

  return Array.from(keys);
}

const panelKeys = extractPanelKeys();
const knownTabs = [...KNOWN_CLIENT_TABS];

describe('client tab ↔ panel lockstep contract', () => {
  it('parses a non-trivial set of panel keys (sanity check)', () => {
    expect(panelKeys.length).toBeGreaterThan(5);
  });

  it('every KNOWN_CLIENT_TAB has a matching panel key', () => {
    const missingPanels = knownTabs.filter((t) => !panelKeys.includes(t));
    expect(missingPanels, `KNOWN_CLIENT_TABS without a panel in ClientDashboard.tsx: ${missingPanels.join(', ')}`).toEqual([]);
  });

  it('every panel key is a KNOWN_CLIENT_TAB', () => {
    const orphanPanels = panelKeys.filter((k) => !(knownTabs as string[]).includes(k));
    expect(orphanPanels, `panels in ClientDashboard.tsx with no matching KNOWN_CLIENT_TAB: ${orphanPanels.join(', ')}`).toEqual([]);
  });

  it('panel keys and KNOWN_CLIENT_TABS are the same set', () => {
    expect(new Set(panelKeys)).toEqual(new Set(knownTabs));
  });

  it('includes the Client IA v2 shell tabs', () => {
    for (const tab of ['deep-dive', 'results', 'settings']) {
      expect(knownTabs).toContain(tab);
      expect(panelKeys).toContain(tab);
    }
  });
});
