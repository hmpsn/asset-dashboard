import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  getPageKeyword,
  listPageKeywords,
  upsertPageKeyword,
} from '../../server/page-keywords.js';
import { METRICS_SOURCE } from '../../shared/types/keywords.js';

let wsId = '';

beforeAll(() => {
  const ws = createWorkspace('PI Strategy Blend Test');
  wsId = ws.id;
});

afterAll(() => {
  deleteWorkspace(wsId);
});

describe('Page Intelligence strategy blend — upsertPageKeywordsBatch safety', () => {
  it('preserves existing Page Intelligence fields after a keyword-only upsert', () => {
    // Seed a page with full PI analysis data
    upsertPageKeyword(wsId, {
      workspaceId: wsId,
      pagePath: '/services/seo',
      pageTitle: 'SEO Services',
      primaryKeyword: 'seo services',
      secondaryKeywords: ['local seo', 'technical seo'],
      optimizationScore: 87,
      optimizationIssues: ['Missing FAQ schema', 'Meta description too short'],
      recommendations: ['Add FAQ section', 'Extend meta to 150+ chars'],
      contentGaps: ['local business schema', 'review signals'],
      analysisGeneratedAt: '2026-04-01T10:00:00Z',
    } as any);

    // Simulate strategy run upserting the same page with keyword data ONLY (no PI fields)
    upsertPageKeyword(wsId, {
      workspaceId: wsId,
      pagePath: '/services/seo',
      pageTitle: 'SEO Services',
      primaryKeyword: 'seo services',
      secondaryKeywords: ['local seo', 'technical seo'],
      metricsSource: METRICS_SOURCE.BULK_LOOKUP,
      volume: 1200,
      difficulty: 45,
      currentPosition: 8,
    } as any);

    const result = getPageKeyword(wsId, '/services/seo');
    expect(result).toBeDefined();
    // PI fields must survive the keyword-only upsert
    expect(result!.optimizationScore).toBe(87);
    expect(result!.optimizationIssues).toContain('Missing FAQ schema');
    expect(result!.recommendations).toContain('Add FAQ section');
    expect(result!.analysisGeneratedAt).toBe('2026-04-01T10:00:00Z');
    // Strategy fields also present
    expect(result!.metricsSource).toBe(METRICS_SOURCE.BULK_LOOKUP);
    expect(result!.volume).toBe(1200);
  });

  it('metricsSource written by strategy is bulk_lookup (valid MetricsSource)', () => {
    const result = getPageKeyword(wsId, '/services/seo');
    expect(result!.metricsSource).toBe(METRICS_SOURCE.BULK_LOOKUP);
    const validValues = Object.values(METRICS_SOURCE);
    expect(validValues).toContain(result!.metricsSource);
  });

  it('multiple pages upserted via batch all appear in listPageKeywords', () => {
    upsertPageKeyword(wsId, { workspaceId: wsId, pagePath: '/services/ppc', pageTitle: 'PPC Services', primaryKeyword: 'ppc', secondaryKeywords: [], metricsSource: METRICS_SOURCE.BULK_LOOKUP } as any);
    upsertPageKeyword(wsId, { workspaceId: wsId, pagePath: '/services/content', pageTitle: 'Content Services', primaryKeyword: 'content marketing', secondaryKeywords: [], metricsSource: METRICS_SOURCE.BULK_LOOKUP } as any);
    const all = listPageKeywords(wsId);
    expect(all.length).toBeGreaterThan(0);
    expect(all.some(p => p.pagePath === '/services/ppc')).toBe(true);
    expect(all.some(p => p.pagePath === '/services/content')).toBe(true);
  });

  it('records score history only when optimization score changes', () => {
    upsertPageKeyword(wsId, {
      pagePath: '/history',
      pageTitle: 'History',
      primaryKeyword: 'history keyword',
      secondaryKeywords: [],
      optimizationScore: 50,
      analysisGeneratedAt: '2026-05-01T00:00:00.000Z',
    });
    upsertPageKeyword(wsId, {
      pagePath: '/history',
      pageTitle: 'History',
      primaryKeyword: 'history keyword',
      secondaryKeywords: [],
      optimizationScore: 50,
      analysisGeneratedAt: '2026-05-02T00:00:00.000Z',
    });
    upsertPageKeyword(wsId, {
      pagePath: '/history',
      pageTitle: 'History',
      primaryKeyword: 'history keyword',
      secondaryKeywords: [],
      optimizationScore: 74,
      analysisGeneratedAt: '2026-05-03T00:00:00.000Z',
    });

    const result = getPageKeyword(wsId, '/history');
    expect(result?.optimizationScoreHistory?.map(item => item.score)).toEqual([50, 74]);
    expect(result?.optimizationScoreHistory?.[1]?.source).toBe('page-analysis');
  });

  it('keeps only the most recent score history snapshots per page', () => {
    for (let i = 0; i < 30; i++) {
      upsertPageKeyword(wsId, {
        pagePath: '/history-retention',
        pageTitle: 'History Retention',
        primaryKeyword: 'history retention keyword',
        secondaryKeywords: [],
        optimizationScore: i + 1,
        analysisGeneratedAt: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }

    const result = getPageKeyword(wsId, '/history-retention');
    expect(result?.optimizationScoreHistory).toHaveLength(25);
    expect(result?.optimizationScoreHistory?.[0]?.score).toBe(6);
    expect(result?.optimizationScoreHistory?.at(-1)?.score).toBe(30);
  });
});
