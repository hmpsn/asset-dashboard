import { describe, it, expect } from 'vitest';

const loadSource = async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  return fs.readFileSync(
    path.resolve(import.meta.dirname, '../server/workspace-intelligence.ts'),
    'utf-8',
  );
};

describe('buildBriefIntelligenceBlock data covered by slice assemblers', () => {
  it('contentPipeline assembler references cannibalization-detection module AND uses cannibalizationWarnings', async () => {
    const src = await loadSource();
    expect(src).toContain('cannibalization-detection');
    expect(src).toContain('cannibalizationWarnings');
  });

  it('contentPipeline assembler references content-decay module AND uses decayAlerts', async () => {
    const src = await loadSource();
    expect(src).toContain('content-decay');
    expect(src).toContain('decayAlerts');
  });
});

describe('buildPlanContextForPage data covered by slice assemblers', () => {
  it('seoContext references ctx.strategy or strategy data', async () => {
    const src = await loadSource();
    expect(src).toMatch(/ctx\.strategy|strategy:/);
  });

  it('pageProfile assembler references site-architecture AND page-keywords modules', async () => {
    const src = await loadSource();
    expect(src).toContain('site-architecture');
    expect(src).toContain('page-keywords');
  });

  it('siteHealth assembler references schema-validator AND schemaErrors', async () => {
    const src = await loadSource();
    expect(src).toContain('schema-validator');
    expect(src).toContain('schemaErrors');
  });
});

describe('buildPageAnalysisContext data covered by pageProfile assembler', () => {
  it('pageProfile assembler uses auditIssues, recommendations, and getPageKeyword', async () => {
    const src = await loadSource();
    expect(src).toContain('auditIssues');
    expect(src).toContain('recommendations');
    expect(src).toContain('getPageKeyword');
  });
});
