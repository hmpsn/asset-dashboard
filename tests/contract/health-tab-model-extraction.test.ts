import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('health-tab model extraction guard', () => {
  it('keeps pure audit transforms in healthTabModel', () => {
    const sectionsSource = readFileSync('src/components/client/health-tab/HealthTabSections.tsx', 'utf-8'); // readFile-ok - extraction contract guard for section/module boundaries.
    const shellSource = readFileSync('src/components/client/health-tab/useHealthTabShell.ts', 'utf-8'); // readFile-ok - extraction contract guard for shell model usage.
    const modelSource = readFileSync('src/components/client/health-tab/healthTabModel.ts', 'utf-8'); // readFile-ok - extraction contract guard for pure model ownership.

    expect(sectionsSource).toContain("from './healthTabModel'");
    expect(sectionsSource).toContain('buildFixTypeGroups');
    expect(sectionsSource).toContain('checkImpact(group.check)');
    expect(sectionsSource).not.toContain('const FIX_TYPE_LABELS');

    expect(shellSource).toContain("from './healthTabModel'");
    expect(shellSource).toContain('filterAuditPages(');
    expect(shellSource).toContain('buildCategoryStats(auditDetail)');
    expect(shellSource).toContain('countInfoIssues(auditDetail)');

    expect(modelSource).toContain('export function checkImpact');
    expect(modelSource).toContain('export function filterAuditPages');
    expect(modelSource).toContain('export function buildCategoryStats');
    expect(modelSource).toContain('export function countInfoIssues');
    expect(modelSource).toContain('export function buildFixTypeGroups');
  });
});
