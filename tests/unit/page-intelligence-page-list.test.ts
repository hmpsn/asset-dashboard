import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('PageIntelligence page list extraction', () => {
  it('keeps page row and expanded detail rendering in the focused page list component', () => {
    const component = readFileSync('src/components/page-intelligence/PageIntelligencePageList.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard

    expect(component).toContain('Run AI Analysis');
    expect(component).toContain('AI Analysis');
    expect(component).toContain('Primary Keyword');
    expect(component).toContain('Fix in SEO Editor');
    expect(component).toContain('Create Brief');
    expect(component).toContain('Add Schema');
    expect(component).toContain('SeoCopyPanel');
  });

  it('keeps PageIntelligence wired to the extracted list without moving background job ownership', () => {
    const pageIntelligence = readFileSync('src/components/PageIntelligence.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const pageList = readFileSync('src/components/page-intelligence/PageIntelligencePageList.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard

    expect(pageIntelligence).toContain("import { PageIntelligencePageList } from './page-intelligence/PageIntelligencePageList'");
    expect(pageIntelligence).toContain('<PageIntelligencePageList');
    expect(pageIntelligence).toContain('startJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS');
    expect(pageIntelligence).toContain('findActiveJob({ type: BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, workspaceId })');
    expect(pageList).not.toContain('useBackgroundTasks');
    expect(pageList).not.toContain('BACKGROUND_JOB_TYPES');
    expect(pageList).not.toContain('startJob(');
  });
});
