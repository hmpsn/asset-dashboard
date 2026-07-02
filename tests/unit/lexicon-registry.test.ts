import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LEXICON,
  DUPLICATE_NAME_ALLOWLIST,
  LEXICON_WORD_CLASSES,
  isValidLexiconTicket,
  type LexiconEntry,
} from '../../shared/types/lexicon.js';
import {
  buildLexiconRegistryReport,
  extractGlossaryTerms,
  scanDuplicateExportedNames,
  stripBlockCommentsAndTemplateLiterals,
  formatLexiconRegistryReportMarkdown,
  SCAN_ROOTS,
  type DuplicateNameScanInput,
} from '../../scripts/lexicon-registry.js';

const GLOSSARY_PATH = path.resolve(process.cwd(), 'GLOSSARY.md');

function loadGlossary(): string {
  return fs.readFileSync(GLOSSARY_PATH, 'utf8');
}

describe('lexicon registry — real registry ↔ GLOSSARY parity', () => {
  it('passes on the committed registry + GLOSSARY (both directions clean)', () => {
    const report = buildLexiconRegistryReport({
      lexicon: LEXICON,
      allowlist: DUPLICATE_NAME_ALLOWLIST,
      glossaryContent: loadGlossary(),
      // no duplicate-scan input here — that path is exercised by fixture tests
    });

    expect(report.registryTermsMissingFromGlossary).toEqual([]);
    expect(report.glossaryTermsMissingFromRegistry).toEqual([]);
    expect(report.allowlistEntriesMissingResolvingTicket).toEqual([]);
    expect(report.allowlistEntriesWithInvalidTicket).toEqual([]);
    expect(report.proposedEntriesMissingResolvingTicket).toEqual([]);
    expect(report.proposedEntriesWithInvalidTicket).toEqual([]);
    expect(report.pass).toBe(true);
  });

  it('every proposed entry carries a valid resolvingTicket (all reconcile-P2 today)', () => {
    const proposed = LEXICON.filter(e => e.wordClass === 'proposed');
    expect(proposed.length).toBeGreaterThan(0);
    for (const entry of proposed) {
      expect(entry.resolvingTicket).toBeTruthy();
      expect(isValidLexiconTicket(entry.resolvingTicket ?? '')).toBe(true);
    }
  });

  it('pins the duplicate-name scan surface (boundary)', () => {
    expect(SCAN_ROOTS).toEqual(['shared/types', 'server']);
  });

  it('every registry entry uses a valid word class', () => {
    for (const entry of LEXICON) {
      expect(LEXICON_WORD_CLASSES).toContain(entry.wordClass);
    }
  });

  it('rejects a wordClass outside the union at compile time', () => {
    // @ts-expect-error — 'invented' is not a LexiconWordClass; the union must reject it.
    const bad: LexiconEntry = { term: 'X', wordClass: 'invented', definition: 'nope' };
    // Runtime touch so the fixture is not dead code; the real assertion is the
    // compile-time @ts-expect-error above (a widened union would make tsc fail).
    expect(bad.term).toBe('X');
  });

  it('seeds the full duplicate-name census into the allowlist', () => {
    // The pre-plan census (inventories JSON §R1) verified 30 duplicate exported
    // names across shared/ + server/. The allowlist must be complete on day one
    // (pr-check --all runs nightly). Deliverable* resolve via R2; the rest are
    // documented-permanent mirror/twin pairs.
    const names = new Set(DUPLICATE_NAME_ALLOWLIST.map(e => e.name));
    expect(names.has('DeliverableType')).toBe(true);
    expect(names.has('DeliverableStatus')).toBe(true);
    expect(names.size).toBe(DUPLICATE_NAME_ALLOWLIST.length);
    // Deliverable* carry R2; the analytics mirror block is permanent.
    const deliverableType = DUPLICATE_NAME_ALLOWLIST.find(e => e.name === 'DeliverableType');
    expect(deliverableType?.resolvingTicket).toBe('R2');
    const ga4 = DUPLICATE_NAME_ALLOWLIST.find(e => e.name === 'GA4Overview');
    expect(ga4?.resolvingTicket).toBe('permanent');
  });
});

describe('lexicon registry — GLOSSARY parity fails on drift (both directions)', () => {
  it('fails when a registry term has no GLOSSARY entry', () => {
    const lexicon: readonly LexiconEntry[] = [
      ...LEXICON,
      {
        term: 'ZZZ_NonexistentRegistryTerm',
        wordClass: 'canonical',
        definition: 'A synthetic term with no GLOSSARY entry.',
      },
    ];
    const report = buildLexiconRegistryReport({
      lexicon,
      allowlist: DUPLICATE_NAME_ALLOWLIST,
      glossaryContent: loadGlossary(),
    });
    expect(report.registryTermsMissingFromGlossary).toContain('ZZZ_NonexistentRegistryTerm');
    expect(report.pass).toBe(false);
  });

  it('fails when a GLOSSARY term has no registry entry', () => {
    const glossaryWithExtra = `${loadGlossary()}\n\n### canonical\n\n**ZZZ_OrphanGlossaryTerm** — appears only in GLOSSARY, not the registry.\n`;
    const report = buildLexiconRegistryReport({
      lexicon: LEXICON,
      allowlist: DUPLICATE_NAME_ALLOWLIST,
      glossaryContent: glossaryWithExtra,
    });
    expect(report.glossaryTermsMissingFromRegistry).toContain('ZZZ_OrphanGlossaryTerm');
    expect(report.pass).toBe(false);
  });
});

describe('lexicon registry — allowlist hygiene', () => {
  it('fails when an allowlist entry is missing its resolvingTicket', () => {
    const allowlist = [
      ...DUPLICATE_NAME_ALLOWLIST,
      // Missing resolvingTicket (empty string) — a hygiene violation.
      { name: 'ZZZBrokenAllowEntry', files: ['a.ts', 'b.ts'], resolvingTicket: '' },
    ];
    const report = buildLexiconRegistryReport({
      lexicon: LEXICON,
      allowlist,
      glossaryContent: loadGlossary(),
    });
    expect(report.allowlistEntriesMissingResolvingTicket).toContain('ZZZBrokenAllowEntry');
    expect(report.pass).toBe(false);
  });

  it('fails when an allowlist entry has a malformed resolvingTicket', () => {
    const allowlist = [
      ...DUPLICATE_NAME_ALLOWLIST,
      // Typo — 'permanant' must not slip past the shape check.
      { name: 'ZZZTypoTicket', files: ['a.ts', 'b.ts'], resolvingTicket: 'permanant' },
    ];
    const report = buildLexiconRegistryReport({
      lexicon: LEXICON,
      allowlist,
      glossaryContent: loadGlossary(),
    });
    expect(report.allowlistEntriesWithInvalidTicket).toContain('ZZZTypoTicket');
    expect(report.pass).toBe(false);
  });
});

describe('lexicon registry — resolvingTicket shape', () => {
  it('accepts R-tickets, reconcile-phase tickets, and permanent', () => {
    expect(isValidLexiconTicket('R2')).toBe(true);
    expect(isValidLexiconTicket('R99')).toBe(true);
    expect(isValidLexiconTicket('reconcile-P2')).toBe(true);
    expect(isValidLexiconTicket('permanent')).toBe(true);
  });

  it('rejects typos and free-form strings', () => {
    expect(isValidLexiconTicket('permanant')).toBe(false);
    expect(isValidLexiconTicket('R2x')).toBe(false);
    expect(isValidLexiconTicket('reconcile-2')).toBe(false);
    expect(isValidLexiconTicket('someday')).toBe(false);
    expect(isValidLexiconTicket('')).toBe(false);
  });
});

describe('lexicon registry — proposed-entry ticket enforcement', () => {
  it('fails when a proposed lexicon entry omits its resolvingTicket', () => {
    const lexicon: readonly LexiconEntry[] = [
      ...LEXICON,
      { term: 'ZZZ_ProposedNoTicket', wordClass: 'proposed', definition: 'proposed but no ticket' },
    ];
    const glossaryWithExtra = `${loadGlossary()}\n\n### proposed\n\n**ZZZ_ProposedNoTicket** — proposed but no ticket.\n`;
    const report = buildLexiconRegistryReport({
      lexicon,
      allowlist: DUPLICATE_NAME_ALLOWLIST,
      glossaryContent: glossaryWithExtra,
    });
    expect(report.proposedEntriesMissingResolvingTicket).toContain('ZZZ_ProposedNoTicket');
    expect(report.pass).toBe(false);
  });

  it('fails when a proposed lexicon entry has a malformed resolvingTicket', () => {
    const lexicon: readonly LexiconEntry[] = [
      ...LEXICON,
      { term: 'ZZZ_ProposedBadTicket', wordClass: 'proposed', definition: 'bad ticket', resolvingTicket: 'reconcile-2' },
    ];
    const glossaryWithExtra = `${loadGlossary()}\n\n### proposed\n\n**ZZZ_ProposedBadTicket** — bad ticket.\n`;
    const report = buildLexiconRegistryReport({
      lexicon,
      allowlist: DUPLICATE_NAME_ALLOWLIST,
      glossaryContent: glossaryWithExtra,
    });
    expect(report.proposedEntriesWithInvalidTicket).toContain('ZZZ_ProposedBadTicket');
    expect(report.pass).toBe(false);
  });
});

describe('lexicon registry — scan ignores comments + template literals', () => {
  it('does not count an export declaration inside a block comment', () => {
    const files: DuplicateNameScanInput[] = [
      { path: 'shared/types/a.ts', source: '/*\nexport interface Ghosted { id: string }\n*/\nexport type Real = string;\n' },
      { path: 'server/b.ts', source: 'export interface Ghosted { id: string }\n' },
    ];
    const scan = scanDuplicateExportedNames(files);
    // 'Ghosted' is real in only ONE file (server/b.ts) — the commented one is stripped → no collision.
    expect(scan.find(d => d.name === 'Ghosted')).toBeUndefined();
  });

  it('does not count an export declaration inside a template literal', () => {
    const files: DuplicateNameScanInput[] = [
      { path: 'shared/types/a.ts', source: 'const snippet = `\nexport interface Templated { id: string }\n`;\nexport type Real = string;\n' },
      { path: 'server/b.ts', source: 'export interface Templated { id: string }\n' },
    ];
    const scan = scanDuplicateExportedNames(files);
    expect(scan.find(d => d.name === 'Templated')).toBeUndefined();
  });

  it('strip helper preserves line count (offset stability)', () => {
    const src = '/*\nexport type X\n*/\nexport type Y = 1;\n';
    const stripped = stripBlockCommentsAndTemplateLiterals(src);
    expect(stripped.split('\n').length).toBe(src.split('\n').length);
    expect(stripped).toContain('export type Y = 1;');
    expect(stripped).not.toContain('export type X');
  });
});

describe('lexicon registry — duplicate-name scan (fixture-driven)', () => {
  it('flags a duplicate exported type name absent from the allowlist', () => {
    const files: DuplicateNameScanInput[] = [
      { path: 'shared/types/alpha.ts', source: 'export interface WidgetShape { id: string; }\n' },
      { path: 'server/beta.ts', source: 'export type WidgetShape = { id: string };\n' },
    ];
    const scan = scanDuplicateExportedNames(files);
    const report = buildLexiconRegistryReport({
      lexicon: LEXICON,
      allowlist: DUPLICATE_NAME_ALLOWLIST,
      glossaryContent: loadGlossary(),
      duplicateScan: scan,
    });
    const unregistered = report.unregisteredDuplicateNames.map(d => d.name);
    expect(unregistered).toContain('WidgetShape');
    expect(report.pass).toBe(false);
  });

  it('does not flag an allowlisted duplicate name', () => {
    const files: DuplicateNameScanInput[] = [
      { path: 'shared/types/brand-engine.ts', source: 'export type DeliverableType = "a" | "b";\n' },
      { path: 'shared/types/client-deliverable.ts', source: 'export type DeliverableType = "c" | "d";\n' },
    ];
    const scan = scanDuplicateExportedNames(files);
    const report = buildLexiconRegistryReport({
      lexicon: LEXICON,
      allowlist: DUPLICATE_NAME_ALLOWLIST,
      glossaryContent: loadGlossary(),
      duplicateScan: scan,
    });
    const unregistered = report.unregisteredDuplicateNames.map(d => d.name);
    expect(unregistered).not.toContain('DeliverableType');
  });

  it('only counts anchored top-level export declarations (no re-exports / indented)', () => {
    const files: DuplicateNameScanInput[] = [
      { path: 'shared/types/a.ts', source: 'export type * from "./b.js";\nexport type { Foo } from "./c.js";\n' },
      { path: 'shared/types/b.ts', source: '  export interface Foo { id: string }\n' }, // indented — not top-level
      { path: 'server/c.ts', source: 'export type Foo = { id: string };\n' },
    ];
    const scan = scanDuplicateExportedNames(files);
    // 'Foo' is declared top-level in exactly ONE file (server/c.ts); the re-export
    // and the indented declaration must not count → not a collision.
    const dup = scan.find(d => d.name === 'Foo');
    expect(dup).toBeUndefined();
  });

  it('a name declared in a single file is not a collision', () => {
    const files: DuplicateNameScanInput[] = [
      { path: 'shared/types/a.ts', source: 'export interface Solo { id: string }\n' },
    ];
    const scan = scanDuplicateExportedNames(files);
    expect(scan.find(d => d.name === 'Solo')).toBeUndefined();
  });
});

describe('lexicon registry — markdown report', () => {
  it('renders a stable report with contract sections', () => {
    const report = buildLexiconRegistryReport({
      lexicon: LEXICON,
      allowlist: DUPLICATE_NAME_ALLOWLIST,
      glossaryContent: loadGlossary(),
    });
    const md = formatLexiconRegistryReportMarkdown(report);
    expect(md).toContain('# Lexicon Registry Report');
    expect(md).toContain('Result:');
  });
});
