import { describe, expect, it } from 'vitest';
import type { UnifiedPage } from '../../../shared/types/page-join';
import { findPageByIdentity, resolveInitialPage, resolvePageIntelligenceTab } from '../../../src/components/page-intelligence-rebuilt/pageIntelligenceRouting';

const pages: UnifiedPage[] = [
  { id: 'page-home', title: 'Home', path: '/', slug: 'home', source: 'static', analyzed: false },
  { id: 'page-services', title: 'Services', path: '/services/custom-sofas', slug: 'custom-sofas', source: 'cms', analyzed: true },
];

describe('Page Intelligence routing', () => {
  it('accepts only supported section tabs', () => {
    expect(resolvePageIntelligenceTab('architecture')).toBe('architecture');
    expect(resolvePageIntelligenceTab('guide')).toBe('guide');
    expect(resolvePageIntelligenceTab('unknown')).toBe('pages');
    expect(resolvePageIntelligenceTab(null)).toBe('pages');
  });

  it('resolves page deep links by id, slug, encoded path, and normalized path', () => {
    expect(findPageByIdentity(pages, 'page-services')?.id).toBe('page-services');
    expect(findPageByIdentity(pages, 'custom-sofas')?.id).toBe('page-services');
    expect(findPageByIdentity(pages, '%2Fservices%2Fcustom-sofas')?.id).toBe('page-services');
    expect(findPageByIdentity(pages, 'services/custom-sofas/')?.id).toBe('page-services');
  });

  it('does not select a page without an explicit valid identity', () => {
    expect(findPageByIdentity(pages, null)).toBeUndefined();
    expect(findPageByIdentity(pages, 'missing-page')).toBeUndefined();
    expect(findPageByIdentity(pages, '%E0%A4%A')).toBeUndefined();
  });

  it('gives the URL page precedence over fix context and otherwise starts collapsed', () => {
    expect(resolveInitialPage(pages, 'page-home', { targetRoute: 'page-intelligence', pageId: 'page-services' })?.id).toBe('page-home');
    expect(resolveInitialPage(pages, null, { targetRoute: 'page-intelligence', pageSlug: 'custom-sofas' })?.id).toBe('page-services');
    expect(resolveInitialPage(pages, null, null)).toBeUndefined();
    expect(resolveInitialPage(pages, null, { targetRoute: 'seo-editor', pageId: 'page-home' })).toBeUndefined();
  });
});
