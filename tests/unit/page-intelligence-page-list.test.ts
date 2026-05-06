import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('PageIntelligence page list extraction', () => {
  it('keeps page row and expanded detail rendering in the focused row/detail components', () => {
    const list = readFileSync('src/components/page-intelligence/PageIntelligencePageList.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const row = readFileSync('src/components/page-intelligence/PageIntelligencePageRow.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const details = readFileSync('src/components/page-intelligence/PageIntelligencePageDetails.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const strategy = readFileSync('src/components/page-intelligence/PageIntelligenceStrategySection.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const analysis = readFileSync('src/components/page-intelligence/PageIntelligenceAnalysisSection.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const actions = readFileSync('src/components/page-intelligence/PageIntelligencePageActions.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const persisted = readFileSync('src/components/page-intelligence/PageIntelligencePersistedAnalysisSummary.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const trackButton = readFileSync('src/components/page-intelligence/PageIntelligenceTrackKeywordButton.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard

    expect(list).toContain('PageIntelligencePageRow');
    expect(row).toContain('PageIntelligencePageDetails');
    expect(details).toContain('Run AI Analysis');
    expect(details).toContain('PageIntelligenceStrategySection');
    expect(details).toContain('PageIntelligenceAnalysisSection');
    expect(details).toContain('PageIntelligencePersistedAnalysisSummary');
    expect(details).toContain('PageIntelligencePageActions');
    expect(strategy).toContain('Primary Keyword');
    expect(strategy).toContain('SeoCopyPanel');
    expect(analysis).toContain('AI Analysis');
    expect(analysis).toContain('Content Metrics');
    expect(persisted).toContain('Analysis on file');
    expect(actions).toContain('Fix in SEO Editor');
    expect(actions).toContain('Create Brief');
    expect(actions).toContain('Add Schema');
    expect(trackButton).toContain('Track');
  });

  it('keeps PageIntelligence wired to the extracted list without moving background job ownership', () => {
    const pageIntelligence = readFileSync('src/components/PageIntelligence.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const pageList = readFileSync('src/components/page-intelligence/PageIntelligencePageList.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const pageRow = readFileSync('src/components/page-intelligence/PageIntelligencePageRow.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const pageDetails = readFileSync('src/components/page-intelligence/PageIntelligencePageDetails.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const detailSections = [
      readFileSync('src/components/page-intelligence/PageIntelligenceStrategySection.tsx', 'utf-8'), // readFile-ok — intentional extraction contract guard
      readFileSync('src/components/page-intelligence/PageIntelligenceAnalysisSection.tsx', 'utf-8'), // readFile-ok — intentional extraction contract guard
      readFileSync('src/components/page-intelligence/PageIntelligencePersistedAnalysisSummary.tsx', 'utf-8'), // readFile-ok — intentional extraction contract guard
      readFileSync('src/components/page-intelligence/PageIntelligencePageActions.tsx', 'utf-8'), // readFile-ok — intentional extraction contract guard
      readFileSync('src/components/page-intelligence/PageIntelligenceTrackKeywordButton.tsx', 'utf-8'), // readFile-ok — intentional extraction contract guard
    ];

    expect(pageIntelligence).toContain("import { PageIntelligencePageList } from './page-intelligence/PageIntelligencePageList'");
    expect(pageIntelligence).toContain('<PageIntelligencePageList');
    expect(pageIntelligence).toContain('startJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS');
    expect(pageIntelligence).toContain('findActiveJob({ type: BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, workspaceId })');
    for (const component of [pageList, pageRow, pageDetails, ...detailSections]) {
      expect(component).not.toContain('useBackgroundTasks');
      expect(component).not.toContain('BACKGROUND_JOB_TYPES');
      expect(component).not.toContain('startJob(');
    }
  });
});
