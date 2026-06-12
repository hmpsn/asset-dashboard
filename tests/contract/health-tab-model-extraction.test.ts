import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('health-tab model extraction guard', () => {
  it('keeps pure audit transforms in healthTabModel', () => {
    const sectionsSource = readFileSync('src/components/client/health-tab/HealthTabSections.tsx', 'utf-8'); // readFile-ok - extraction contract guard for section/module boundaries.
    const fixByTypeSource = readFileSync('src/components/client/health-tab/HealthFixByTypeSection.tsx', 'utf-8'); // readFile-ok - extraction contract guard for by-fix-type section boundary.
    const shellSource = readFileSync('src/components/client/health-tab/useHealthTabShell.ts', 'utf-8'); // readFile-ok - extraction contract guard for shell model usage.
    const modelSource = readFileSync('src/components/client/health-tab/healthTabModel.ts', 'utf-8'); // readFile-ok - extraction contract guard for pure model ownership.

    // HealthTabSections still imports from healthTabModel (for checkImpact)
    expect(sectionsSource).toContain("from './healthTabModel'");
    // buildFixTypeGroups moved to the extracted HealthFixByTypeSection (R1-B extraction)
    expect(fixByTypeSource).toContain('buildFixTypeGroups');
    expect(fixByTypeSource).toContain("from './healthTabModel'");
    // checkImpact is used in both sections and the fix-by-type section
    expect(fixByTypeSource).toContain('checkImpact(group.check)');
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
