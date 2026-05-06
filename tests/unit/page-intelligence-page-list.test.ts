import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('PageIntelligence page list extraction', () => {
  it('keeps page row and expanded detail rendering in the focused row/detail components', () => {
    const list = readFileSync('src/components/page-intelligence/PageIntelligencePageList.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const row = readFileSync('src/components/page-intelligence/PageIntelligencePageRow.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const details = readFileSync('src/components/page-intelligence/PageIntelligencePageDetails.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard

    expect(list).toContain('PageIntelligencePageRow');
    expect(row).toContain('PageIntelligencePageDetails');
    expect(details).toContain('Run AI Analysis');
    expect(details).toContain('AI Analysis');
    expect(details).toContain('Primary Keyword');
    expect(details).toContain('Fix in SEO Editor');
    expect(details).toContain('Create Brief');
    expect(details).toContain('Add Schema');
    expect(details).toContain('SeoCopyPanel');
  });

  it('keeps PageIntelligence wired to the extracted list without moving background job ownership', () => {
    const pageIntelligence = readFileSync('src/components/PageIntelligence.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const pageList = readFileSync('src/components/page-intelligence/PageIntelligencePageList.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const pageRow = readFileSync('src/components/page-intelligence/PageIntelligencePageRow.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const pageDetails = readFileSync('src/components/page-intelligence/PageIntelligencePageDetails.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard

    expect(pageIntelligence).toContain("import { PageIntelligencePageList } from './page-intelligence/PageIntelligencePageList'");
    expect(pageIntelligence).toContain('<PageIntelligencePageList');
    expect(pageIntelligence).toContain('startJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS');
    expect(pageIntelligence).toContain('findActiveJob({ type: BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, workspaceId })');
    for (const component of [pageList, pageRow, pageDetails]) {
      expect(component).not.toContain('useBackgroundTasks');
      expect(component).not.toContain('BACKGROUND_JOB_TYPES');
      expect(component).not.toContain('startJob(');
    }
  });
});
