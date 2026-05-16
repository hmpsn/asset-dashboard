import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('client HealthTab all-pages extraction', () => {
  it('keeps all-pages controls in extracted section component', () => {
    const healthTabSource = readFileSync('src/components/client/HealthTab.tsx', 'utf-8'); // readFile-ok - extraction contract guard for HealthTab shell composition boundaries.
    const sectionSource = readFileSync('src/components/client/health-tab/HealthTabAllPagesList.tsx', 'utf-8'); // readFile-ok - extraction contract guard for all-pages section ownership.
    const modelSource = readFileSync('src/components/client/health-tab/healthTabModel.ts', 'utf-8'); // readFile-ok - extraction contract guard for pure health-tab helper ownership.

    expect(healthTabSource).toContain("from './health-tab/HealthTabAllPagesList'");
    expect(healthTabSource).toContain('<HealthTabAllPagesList');
    expect(healthTabSource).not.toContain('By Fix Type');
    expect(healthTabSource).not.toContain('No pages match your filters');

    expect(sectionSource).toContain('export function HealthTabAllPagesList');
    expect(sectionSource).toContain('By Fix Type');
    expect(sectionSource).toContain('No pages match your filters');
    expect(sectionSource).toContain('buildFixTypeGroups');

    expect(modelSource).toContain('export function filterAuditPages');
    expect(modelSource).toContain('export function buildFixTypeGroups');
    expect(modelSource).toContain('export function checkImpact');
  });
});
