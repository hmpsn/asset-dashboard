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
import {
  BOOK_ROOT_NAV_ID,
  NAV_DESTINATION_REGISTRY,
  NAV_REGISTRY,
  NAV_REGISTRY_BY_ID,
  NON_PAGE_NAV_DESTINATIONS,
  NON_REGISTRY_PAGES,
  REBUILT_NAV_ZONES,
  isNavEntryHidden,
  resolveNavPath,
  resolveNavLabel,
  resolveRebuiltNavZoneLabel,
} from '../../src/lib/navRegistry';
import type { Page } from '../../src/routes';

const ROOT = join(__dirname, '../..');
const ROUTES_FILE = join(ROOT, 'src/routes.ts');
const APP_FILE = join(ROOT, 'src/App.tsx');
const MCP_JOB_ACTIONS_FILE = join(ROOT, 'server/mcp/tools/job-actions.ts');

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

  it('models the rebuilt book root as an explicit flag-ON, workspace-less destination', () => {
    const entry = NAV_REGISTRY_BY_ID[BOOK_ROOT_NAV_ID];

    expect(entry.label).toBe('Command Center');
    expect(entry.scope).toBe('book');
    expect(resolveRebuiltNavZoneLabel(BOOK_ROOT_NAV_ID)).toBe('All workspaces');
    expect(resolveNavPath(entry, null)).toBe('/');
    expect(isNavEntryHidden(entry, () => false)).toBe(true);
    expect(isNavEntryHidden(entry, (flag) => flag === 'ui-rebuild-shell')).toBe(false);
  });

  it('keeps Requests as a labeled Client-Facing rail home', () => {
    expect(NAV_REGISTRY_BY_ID.requests.label).toBe('Requests');
    expect(resolveRebuiltNavZoneLabel('requests')).toBe('Client-Facing');
  });

  it('keeps AI Visibility in Search & Site Health and visible only with the rebuilt shell ON', () => {
    const entry = NAV_REGISTRY_BY_ID['ai-visibility'];
    expect(entry.label).toBe('AI Visibility');
    expect(resolveRebuiltNavZoneLabel('ai-visibility')).toBe('Search & Site Health');
    expect(isNavEntryHidden(entry, () => false)).toBe(true);
    expect(isNavEntryHidden(entry, (flag) => flag === 'ui-rebuild-shell')).toBe(false);
  });

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

  it('has no orphan registry entries beyond explicit non-Page destinations', () => {
    const unionSet = new Set(pageUnion);
    const allowedNonPages = new Set<string>(NON_PAGE_NAV_DESTINATIONS);
    const orphans = NAV_DESTINATION_REGISTRY.filter((e) => !unionSet.has(e.id) && !allowedNonPages.has(e.id));
    expect(orphans.map((e) => e.id)).toEqual([]);
  });

  it('keeps every non-Page destination explicit and registered', () => {
    const unionSet = new Set(pageUnion);
    const actualNonPages = NAV_DESTINATION_REGISTRY.filter((entry) => !unionSet.has(entry.id)).map((entry) => entry.id);

    expect(actualNonPages).toEqual(NON_PAGE_NAV_DESTINATIONS);
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
    const ids = NAV_DESTINATION_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('registry icons are unique enough for sidebar scanning', () => {
    const seen = new Map<unknown, string>();
    const duplicates: string[] = [];
    for (const entry of NAV_DESTINATION_REGISTRY) {
      const prior = seen.get(entry.icon);
      if (prior) duplicates.push(`${prior}/${entry.id}`);
      else seen.set(entry.icon, entry.id);
    }

    expect(duplicates).toEqual([]);
  });

  it('NAV_REGISTRY_BY_ID resolves every entry', () => {
    for (const entry of NAV_DESTINATION_REGISTRY) {
      expect(NAV_REGISTRY_BY_ID[entry.id]).toBe(entry);
    }
  });

  it('every entry has a non-empty label and description', () => {
    for (const entry of NAV_DESTINATION_REGISTRY) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('keeps legacy labels flag-OFF and resolves the D2 sidebar winners flag-ON', () => {
    const expected = [
      ['seo-strategy', 'Strategy', 'Insights Engine'],
      ['seo-keywords', 'Keyword Hub', 'Keywords'],
      ['media', 'Assets', 'Asset Manager'],
      ['content-pipeline', 'Pipeline', 'Content Pipeline'],
    ] as const;

    for (const [id, legacyLabel, rebuiltLabel] of expected) {
      const entry = NAV_REGISTRY_BY_ID[id];
      expect(resolveNavLabel(entry, () => false)).toBe(legacyLabel);
      expect(resolveNavLabel(entry, (flag) => flag === 'ui-rebuild-shell')).toBe(rebuiltLabel);
    }
  });

  it('keeps rebuilt zone labels and destination membership in the registry', () => {
    const zoneIds = REBUILT_NAV_ZONES.flatMap((zone) => zone.items);
    expect(new Set(zoneIds).size).toBe(zoneIds.length);
    expect(resolveRebuiltNavZoneLabel('seo-keywords')).toBe('Strategy & Content');
    expect(resolveRebuiltNavZoneLabel('media')).toBe('Search & Site Health');
    expect(resolveRebuiltNavZoneLabel('outcomes')).toBe('Client-Facing');
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

  it('local-seo is a real Local Presence admin page under the Strategy group', () => {
    expect(pageUnion).toContain('local-seo');

    const entry = NAV_REGISTRY_BY_ID['local-seo'];
    expect(entry).toBeDefined();
    expect(entry.label).toBe('Local Presence');
    expect(entry.group).toBe('seo-strategy');

    const appSource = readFileSync(APP_FILE, 'utf8'); // readFile-ok — static route branch contract.
    expect(appSource).toContain("tab === 'local-seo'");
    expect(appSource).toContain('LocalPresencePage');

    const mcpJobSource = readFileSync(MCP_JOB_ACTIONS_FILE, 'utf8'); // readFile-ok — MCP job result URL contract.
    expect(mcpJobSource).toContain("buildDashboardUrl(workspaceId, 'local-seo')");
  });
});
