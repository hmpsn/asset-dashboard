import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('PageIntelligence pages header extraction', () => {
  it('keeps the pages tab controls in the focused header component', () => {
    const component = readFileSync('src/components/page-intelligence/PageIntelligencePagesHeader.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard

    expect(component).toContain('Analyze Remaining');
    expect(component).toContain('Re-analyze All');
    expect(component).toContain('Analyze All Pages');
    expect(component).toContain('Page Analysis Failed');
    expect(component).toContain('Analysis complete');
    expect(component).toContain('Fix These First');
    expect(component).toContain('Search pages, keywords...');
    expect(component).toContain('ProgressIndicator');
  });

  it('keeps PageIntelligence wired to the extracted header without moving background job ownership', () => {
    const pageIntelligence = readFileSync('src/components/PageIntelligence.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard

    expect(pageIntelligence).toContain("import { PageIntelligencePagesHeader } from './page-intelligence/PageIntelligencePagesHeader'");
    expect(pageIntelligence).toContain('<PageIntelligencePagesHeader');
    expect(pageIntelligence).toContain('startJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS');
    expect(pageIntelligence).toContain('findActiveJob({ type: BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, workspaceId })');
  });
});
