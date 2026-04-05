import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  getPageKeyword,
  listPageKeywords,
  upsertPageKeyword,
} from '../../server/page-keywords.js';

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
      metricsSource: 'bulk_lookup',
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
    expect(result!.metricsSource).toBe('bulk_lookup');
    expect(result!.volume).toBe(1200);
  });

  it('metricsSource written by strategy is bulk_lookup (valid MetricsSource)', () => {
    const result = getPageKeyword(wsId, '/services/seo');
    expect(result!.metricsSource).toBe('bulk_lookup');
    const validValues = ['exact', 'partial_match', 'ai_estimate', 'bulk_lookup'];
    expect(validValues).toContain(result!.metricsSource);
  });

  it('multiple pages upserted via batch all appear in listPageKeywords', () => {
    upsertPageKeyword(wsId, { workspaceId: wsId, pagePath: '/services/ppc', pageTitle: 'PPC Services', primaryKeyword: 'ppc', secondaryKeywords: [], metricsSource: 'bulk_lookup' } as any);
    upsertPageKeyword(wsId, { workspaceId: wsId, pagePath: '/services/content', pageTitle: 'Content Services', primaryKeyword: 'content marketing', secondaryKeywords: [], metricsSource: 'bulk_lookup' } as any);
    const all = listPageKeywords(wsId);
    expect(all.length).toBeGreaterThan(0);
    expect(all.some(p => p.pagePath === '/services/ppc')).toBe(true);
    expect(all.some(p => p.pagePath === '/services/content')).toBe(true);
  });
});
