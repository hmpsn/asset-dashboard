import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Source-level assertions: verifies PageIntelligence.tsx uses the shared
 * MetricsSource type and does NOT contain the old string literal union.
 */
describe('PageIntelligence metricsSource — type contract', () => {
  it('imports MetricsSource from shared/types/keywords', () => {
    const src = readFileSync('src/components/PageIntelligence.tsx', 'utf-8'); // readFile-ok — intentional type contract guard
    expect(src).toContain("from '../../shared/types/keywords");
    expect(src).toContain('MetricsSource');
  });

  it('does NOT contain the old string literal union for metricsSource', () => {
    const src = readFileSync('src/components/PageIntelligence.tsx', 'utf-8'); // readFile-ok — intentional type contract guard
    expect(src).not.toContain("'exact' | 'partial_match' | 'ai_estimate'");
  });
});

describe('PageIntelligence background page-analysis contract', () => {
  it('rediscovers active page-analysis jobs from useBackgroundTasks', () => {
    const src = readFileSync('src/components/PageIntelligence.tsx', 'utf-8'); // readFile-ok — intentional background job rediscovery guard

    expect(src).toContain('findActiveJob');
    expect(src).toContain('BACKGROUND_JOB_TYPES.PAGE_ANALYSIS');
    expect(src).toContain('findActiveJob({ type: BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, workspaceId })');
    expect(src).toContain('trackedBulkJob');
  });

  it('starts page-analysis through shared background job metadata, not a raw string', () => {
    const src = readFileSync('src/components/PageIntelligence.tsx', 'utf-8'); // readFile-ok — intentional background job start guard

    expect(src).toContain('startJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS');
    expect(src).not.toContain("startJob('page-analysis'");
  });

  it('does not keep a second local bulk progress state beside the background job', () => {
    const src = readFileSync('src/components/PageIntelligence.tsx', 'utf-8'); // readFile-ok — intentional background job state contract guard

    expect(src).not.toContain('setBulkProgress');
    expect(src).not.toContain('cancelBulkRef');
    expect(src).toContain('queryKeys.admin.pageJoinPages(siteId, workspaceId)');
  });
});
