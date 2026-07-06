// tests/contract/ds-rebuilt-a11y-coverage.test.ts
//
// Ratchet for the F2b accessibility floor. F2b seeded `expectNoA11yViolations(container)`
// across the shipped @ds-rebuilt primitives; without a ratchet that floor silently rots as
// Phase A fans out per-surface (a new primitive ships a test with no a11y assertion and
// every gate stays green). This contract asserts: every @ds-rebuilt design-system primitive
// that HAS a component test must call the a11y helper in it.
//
// See docs/rules/ui-rebuild-consistency.md. Enforced in the contract test lane.
import { readFileSync, readdirSync } from 'fs';
import { basename, join, relative } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const DS_MARKER = '@ds-rebuilt';
const A11Y_HELPER = 'expectNoA11yViolations';
const COMPONENT_ROOTS = ['src/components/ui', 'src/components/layout'];
const TEST_ROOTS = ['tests/component/ui', 'tests/component/layout'];

// @ds-rebuilt primitives that have a test file but are intentionally exempt from the a11y
// floor. MUST stay empty unless a primitive surfaces a genuinely-hard axe violation that
// cannot be fixed in the introducing PR — and then only WITH a DEF-* ledger row. Never
// add a name here silently; the burn-down test below rejects stale entries.
const KNOWN_A11Y_GAPS = new Set<string>([]);

function collectTsx(relDir: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) { // readdir-ok — static scan of @ds-rebuilt primitives for a11y coverage
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx')) results.push(full);
    }
  };
  walk(join(ROOT, relDir));
  return results;
}

// component basename ("NavGroup") -> absolute test-file path
const testIndex = new Map<string, string>(
  TEST_ROOTS.flatMap(collectTsx)
    .filter(file => file.endsWith('.test.tsx'))
    .map(file => [basename(file, '.test.tsx'), file]),
);

// @ds-rebuilt component basename -> absolute source path
const dsComponents = COMPONENT_ROOTS.flatMap(collectTsx)
  .filter(file => readFileSync(file, 'utf8').includes(DS_MARKER)) // readFile-ok — static scan for the @ds-rebuilt marker
  .map(file => ({ name: basename(file, '.tsx'), file }));

describe('@ds-rebuilt primitives carry the accessibility floor', () => {
  it('discovers the @ds-rebuilt primitive set', () => {
    // Sanity floor so a bad glob (finding nothing) can't make this contract vacuously pass.
    expect(dsComponents.length).toBeGreaterThan(15);
  });

  it('every @ds-rebuilt primitive that has a test asserts no a11y violations', () => {
    const gaps: string[] = [];
    for (const { name } of dsComponents) {
      const testFile = testIndex.get(name);
      if (!testFile || KNOWN_A11Y_GAPS.has(name)) continue;
      if (!readFileSync(testFile, 'utf8').includes(A11Y_HELPER)) { // readFile-ok — static scan for the a11y assertion
        gaps.push(`${name} -> ${relative(ROOT, testFile)}`);
      }
    }
    expect(
      gaps,
      `@ds-rebuilt primitives have a test file but no ${A11Y_HELPER} call. Add ` +
        `\`const { container } = render(...)\` + \`await ${A11Y_HELPER}(container)\` ` +
        `(see tests/component/ui/NavGroup.test.tsx). Only if it surfaces a genuinely-hard ` +
        `violation, add the name to KNOWN_A11Y_GAPS with a DEF-* ledger row.`,
    ).toEqual([]);
  });

  it('KNOWN_A11Y_GAPS has no stale entries (burn-down)', () => {
    const dsNames = new Set(dsComponents.map(component => component.name));
    const stale: string[] = [];
    for (const name of KNOWN_A11Y_GAPS) {
      const testFile = testIndex.get(name);
      if (!testFile || !dsNames.has(name)) {
        stale.push(`${name} (not a @ds-rebuilt primitive with a test file)`);
        continue;
      }
      if (readFileSync(testFile, 'utf8').includes(A11Y_HELPER)) { // readFile-ok — verify the allowlisted gap is still real
        stale.push(`${name} (now covered — remove it from KNOWN_A11Y_GAPS)`);
      }
    }
    expect(stale).toEqual([]);
  });
});
