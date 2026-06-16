import { describe, it, expect } from 'vitest';
import { REC_TYPE_ADMIN_TAB, buildRecFixContext } from '../../src/lib/recTypeTab';
import type { Recommendation, RecType } from '../../shared/types/recommendations';

const ALL_REC_TYPES: RecType[] = [
  'metadata', 'schema', 'technical', 'performance', 'accessibility', 'content',
  'content_refresh', 'strategy', 'aeo', 'keyword_gap', 'topic_cluster',
  'cannibalization', 'local_visibility', 'local_service_gap',
];

describe('REC_TYPE_ADMIN_TAB', () => {
  it('maps every RecType to an admin Page tab', () => {
    for (const t of ALL_REC_TYPES) {
      expect(REC_TYPE_ADMIN_TAB[t]).toBeTruthy();
    }
  });

  it('routes content types to content-pipeline (NOT the zombie seo-briefs redirect)', () => {
    expect(REC_TYPE_ADMIN_TAB.content).toBe('content-pipeline');
    expect(REC_TYPE_ADMIN_TAB.content_refresh).toBe('content-pipeline');
  });

  it('buildRecFixContext resolves the tab + a targetRoute-bearing fixContext', () => {
    const rec = {
      type: 'metadata',
      affectedPages: ['/about'],
      title: 'Fix the about-page title',
      targetKeyword: 'about us',
    } as unknown as Recommendation;
    const { tab, fixContext } = buildRecFixContext(rec);
    expect(tab).toBe('seo-editor');
    expect(fixContext).toEqual({
      targetRoute: 'seo-editor',
      pageSlug: '/about',
      pageName: 'Fix the about-page title',
      primaryKeyword: 'about us',
    });
  });

  it('content rec routes its fixContext to content-pipeline', () => {
    const rec = { type: 'content_refresh', affectedPages: [], title: 'Refresh post', targetKeyword: 'kw' } as unknown as Recommendation;
    const { tab, fixContext } = buildRecFixContext(rec);
    expect(tab).toBe('content-pipeline');
    expect(fixContext.targetRoute).toBe('content-pipeline');
  });
});
