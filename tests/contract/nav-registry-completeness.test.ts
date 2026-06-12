// tests/contract/nav-registry-completeness.test.ts
//
// CONTRACT: the navigation registry (src/lib/navRegistry.tsx) is the single
// source of truth for admin-surface navigation metadata (label, group,
// needsSite, description). It is consumed by Sidebar, CommandPalette, and
// Breadcrumbs.
//
// This test enforces two halves of the registry/Page-union contract:
//   1. Every non-redirect `Page` union value has a registry entry.
//   2. Every registry entry maps to a real `Page` union value (no orphans).
//
// Redirect-only / legacy-folded Page values are intentionally excluded and
// listed here explicitly so the exclusion is auditable rather than silent.
//
// readFile-ok — this test reads src/routes.ts source for static union parsing.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { NAV_REGISTRY, NAV_REGISTRY_BY_ID, NON_REGISTRY_PAGES } from '../../src/lib/navRegistry';
import type { Page } from '../../src/routes';

const ROOT = join(__dirname, '../..');
const ROUTES_FILE = join(ROOT, 'src/routes.ts');

/** Parse the `Page` union string-literal members out of src/routes.ts. */
function parsePageUnion(): string[] {
  const src = readFileSync(ROUTES_FILE, 'utf8');
  const match = src.match(/export type Page\s*=([\s\S]*?);/);
  if (!match) throw new Error('Could not locate the Page union in src/routes.ts');
  const body = match[1];
  const values = body.match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
  return [...new Set(values)];
}

describe('navRegistry completeness', () => {
  const pageUnion = parsePageUnion();

  it('parses a non-empty Page union from routes.ts', () => {
    expect(pageUnion.length).toBeGreaterThan(10);
    expect(pageUnion).toContain('home');
    expect(pageUnion).toContain('diagnostics');
  });

  it('every non-redirect Page union value has a registry entry', () => {
    const registered = new Set(NAV_REGISTRY.map((e) => e.id));
    const excluded = new Set<string>(NON_REGISTRY_PAGES);
    const missing = pageUnion.filter((p) => !registered.has(p as Page) && !excluded.has(p));
    expect(missing).toEqual([]);
  });

  it('has no orphan registry entries (every entry is a real Page value)', () => {
    const unionSet = new Set(pageUnion);
    const orphans = NAV_REGISTRY.filter((e) => !unionSet.has(e.id));
    expect(orphans.map((e) => e.id)).toEqual([]);
  });

  it('excluded (redirect/legacy) Page values are not also registered', () => {
    const registered = new Set(NAV_REGISTRY.map((e) => e.id));
    const overlap = NON_REGISTRY_PAGES.filter((p) => registered.has(p as Page));
    expect(overlap).toEqual([]);
  });

  it('every excluded Page value is a real Page union value', () => {
    const unionSet = new Set(pageUnion);
    const bogus = NON_REGISTRY_PAGES.filter((p) => !unionSet.has(p));
    expect(bogus).toEqual([]);
  });

  it('the union of registered + excluded covers the entire Page union', () => {
    const registered = new Set(NAV_REGISTRY.map((e) => e.id as string));
    const excluded = new Set<string>(NON_REGISTRY_PAGES);
    const uncovered = pageUnion.filter((p) => !registered.has(p) && !excluded.has(p));
    expect(uncovered).toEqual([]);
  });

  it('registry ids are unique', () => {
    const ids = NAV_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('NAV_REGISTRY_BY_ID resolves every entry', () => {
    for (const entry of NAV_REGISTRY) {
      expect(NAV_REGISTRY_BY_ID[entry.id]).toBe(entry);
    }
  });

  it('every entry has a non-empty label and description', () => {
    for (const entry of NAV_REGISTRY) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('drift fixes: diagnostics is registered, workspace-scoped, and needs no site', () => {
    const diag = NAV_REGISTRY_BY_ID['diagnostics'];
    expect(diag).toBeDefined();
    expect(diag.needsSite).toBeFalsy();
  });

  it('drift fix: requests does NOT require a site (client communication must work pre-onboarding)', () => {
    const requests = NAV_REGISTRY_BY_ID['requests'];
    expect(requests).toBeDefined();
    expect(requests.needsSite).toBeFalsy();
  });

  it('drift fix: stale seo-briefs / content nav entries are not registered (folded into content-pipeline)', () => {
    const registered = new Set(NAV_REGISTRY.map((e) => e.id as string));
    expect(registered.has('seo-briefs')).toBe(false);
    expect(registered.has('content')).toBe(false);
  });
});
