import { describe, expect, it } from 'vitest';
import {
  buildCategoryStats,
  buildFixTypeGroups,
  checkImpact,
  countInfoIssues,
  filterAuditPages,
} from '../../src/components/client/health-tab/healthTabModel';
import type { AuditDetail } from '../../src/components/client/types';

function makeAuditDetail(): AuditDetail {
  return {
    id: 'audit_1',
    createdAt: '2026-05-15T00:00:00.000Z',
    siteName: 'Demo Site',
    previousScore: 72,
    audit: {
      siteScore: 76,
      totalPages: 2,
      errors: 1,
      warnings: 2,
      infos: 1,
      pages: [
        {
          pageId: 'p1',
          page: 'Home',
          slug: 'home',
          url: '/home',
          score: 81,
          issues: [
            { check: 'title', severity: 'error', category: 'content', message: 'Title too short', recommendation: 'Expand title' },
            { check: 'meta-description', severity: 'warning', category: 'content', message: 'Missing meta description', recommendation: 'Add meta description' },
            { check: 'lang', severity: 'info', category: 'technical', message: 'Missing lang attribute', recommendation: 'Add lang attribute' },
          ],
        },
        {
          pageId: 'p2',
          page: 'Pricing',
          slug: 'pricing',
          url: '/pricing',
          score: 65,
          issues: [
            { check: 'h1', severity: 'warning', category: 'content', message: 'Missing H1', recommendation: 'Add H1' },
          ],
        },
      ],
      siteWideIssues: [],
    },
    scoreHistory: [],
  };
}

describe('healthTabModel', () => {
  it('maps check impact hints by key', () => {
    expect(checkImpact('title')).toContain('Google search results');
    expect(checkImpact('unknown-check')).toBeNull();
  });

  it('filters pages by search and severity contract', () => {
    const detail = makeAuditDetail();

    const warningPages = filterAuditPages(
      detail.audit.pages,
      '',
      'warning',
      false,
      (url) => `https://example.com${url}`,
    );
    expect(warningPages.map((page) => page.pageId)).toEqual(['p1', 'p2']);

    const noInfoPages = filterAuditPages(
      detail.audit.pages,
      '',
      'all',
      false,
      (url) => `https://example.com${url}`,
    );
    expect(noInfoPages.map((page) => page.pageId)).toEqual(['p1', 'p2']);

    const searchFiltered = filterAuditPages(
      detail.audit.pages,
      'pricing',
      'all',
      true,
      (url) => `https://example.com${url}`,
    );
    expect(searchFiltered.map((page) => page.pageId)).toEqual(['p2']);
  });

  it('builds category stats and info issue totals', () => {
    const detail = makeAuditDetail();

    expect(countInfoIssues(detail)).toBe(1);
    expect(buildCategoryStats(detail)).toEqual({
      content: { errors: 1, warnings: 2, infos: 0 },
      technical: { errors: 0, warnings: 0, infos: 1 },
    });
  });

  it('groups fix types and keeps highest severity', () => {
    const detail = makeAuditDetail();

    const groups = buildFixTypeGroups(detail, 'all', false);
    expect(groups.length).toBe(3);
    expect(groups[0].check).toBe('title');
    expect(groups[0].severity).toBe('error');
    expect(groups.map((group) => group.check)).not.toContain('lang');

    const infoGroups = buildFixTypeGroups(detail, 'info', true);
    expect(infoGroups.length).toBe(1);
    expect(infoGroups[0].check).toBe('lang');
    expect(infoGroups[0].severity).toBe('info');
  });
});
