/**
 * Wave 10 — recommendations extended coverage
 *
 * Targets uncovered exported helpers in server/recommendations.ts:
 *   - recommendationOutcomeActionType
 *   - getRecSourceCategory
 *   - RecSource builders
 *   - toPageSlug
 *   - migrateSourceKey
 *   - buildMergeKey
 *   - pageImportanceMultiplier
 *   - checkToRecType
 *   - mapToProduct
 *   - inferSchemaTypes
 *   - computeImpactScore
 *   - determinePriority
 *   - inferPageType (extended cases)
 *   - isIntentMismatch (product page case)
 */

import { describe, it, expect, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  recommendationOutcomeActionType,
  getRecSourceCategory,
  RecSource,
  toPageSlug,
  migrateSourceKey,
  buildMergeKey,
  pageImportanceMultiplier,
  checkToRecType,
  mapToProduct,
  inferSchemaTypes,
  computeImpactScore,
  determinePriority,
  inferPageType,
  isIntentMismatch,
  saveRecommendations,
  loadRecommendations,
  updateRecommendationStatus,
  dismissRecommendation,
} from '../../server/recommendations.js';
import type { RecommendationSet } from '../../shared/types/recommendations.js';

const recWorkspaceIds = new Set<string>();

afterEach(() => {
  for (const workspaceId of recWorkspaceIds) {
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(workspaceId);
  }
  recWorkspaceIds.clear();
});

function makeWorkspaceId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeRecommendationSet(workspaceId: string): RecommendationSet {
  const now = new Date().toISOString();
  return {
    workspaceId,
    generatedAt: now,
    recommendations: [
      {
        id: 'rec-1',
        workspaceId,
        priority: 'fix_now',
        type: 'technical',
        title: 'Fix title tag',
        description: 'Title tag is missing',
        insight: 'Missing title suppresses CTR',
        impact: 'high',
        effort: 'low',
        impactScore: 90,
        source: 'audit:title',
        affectedPages: ['/services'],
        trafficAtRisk: 300,
        impressionsAtRisk: 2500,
        estimatedGain: '5-15%',
        actionType: 'manual',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'rec-2',
        workspaceId,
        priority: 'fix_soon',
        type: 'schema',
        title: 'Add FAQ schema',
        description: 'FAQ blocks detected without schema',
        insight: 'Rich results opportunity',
        impact: 'medium',
        effort: 'medium',
        impactScore: 52,
        source: 'audit:structured-data',
        affectedPages: ['/faq'],
        trafficAtRisk: 80,
        impressionsAtRisk: 900,
        estimatedGain: '5-10%',
        actionType: 'purchase',
        productType: 'schema_page',
        productPrice: 39,
        status: 'in_progress',
        assignedTo: 'team',
        createdAt: now,
        updatedAt: now,
      },
    ],
    summary: {
      fixNow: 1,
      fixSoon: 1,
      fixLater: 0,
      ongoing: 0,
      totalImpactScore: 142,
      trafficAtRisk: 380,
      estimatedRecoverableClicks: 46,
      estimatedRecoverableImpressions: 408,
    },
  };
}

// ─── recommendationOutcomeActionType ─────────────────────────────────────────

describe('recommendationOutcomeActionType', () => {
  it('returns content_refreshed for content_refresh type', () => {
    expect(recommendationOutcomeActionType('content_refresh', 'decay:/blog')).toBe('content_refreshed');
  });

  it('returns meta_updated for metadata type', () => {
    expect(recommendationOutcomeActionType('metadata', 'audit:title')).toBe('meta_updated');
  });

  it('returns schema_deployed for schema type', () => {
    expect(recommendationOutcomeActionType('schema', 'audit:structured-data')).toBe('schema_deployed');
  });

  it('returns content_published for content type', () => {
    expect(recommendationOutcomeActionType('content', 'strategy:content-gap')).toBe('content_published');
  });

  it('returns content_published for strategy type with content-gap source prefix', () => {
    expect(recommendationOutcomeActionType('strategy', 'strategy:content-gap')).toBe('content_published');
    expect(recommendationOutcomeActionType('strategy', 'strategy:content-gap:long-form')).toBe('content_published');
  });

  it('returns insight_acted_on for strategy type with non-content-gap source', () => {
    expect(recommendationOutcomeActionType('strategy', 'strategy:quick-win')).toBe('insight_acted_on');
    expect(recommendationOutcomeActionType('strategy', 'strategy:ranking-opportunity')).toBe('insight_acted_on');
  });

  it('returns audit_fix_applied for all other types', () => {
    expect(recommendationOutcomeActionType('technical', 'audit:ssl')).toBe('audit_fix_applied');
    expect(recommendationOutcomeActionType('aeo', 'audit:aeo-author')).toBe('audit_fix_applied');
    expect(recommendationOutcomeActionType('performance', 'audit:cwv')).toBe('audit_fix_applied');
    expect(recommendationOutcomeActionType('accessibility', 'audit:img-alt')).toBe('audit_fix_applied');
  });
});

// ─── getRecSourceCategory ────────────────────────────────────────────────────

describe('getRecSourceCategory', () => {
  it('returns "audit" for bare "audit" source', () => {
    expect(getRecSourceCategory('audit')).toBe('audit');
  });

  it('returns "audit" for audit:check sources', () => {
    expect(getRecSourceCategory('audit:title')).toBe('audit');
    expect(getRecSourceCategory('audit:site-wide:ssl')).toBe('audit');
  });

  it('returns "strategy" for strategy sources', () => {
    expect(getRecSourceCategory('strategy:content-gap')).toBe('strategy');
    expect(getRecSourceCategory('strategy:quick-win')).toBe('strategy');
    expect(getRecSourceCategory('strategy:ranking-opportunity')).toBe('strategy');
  });

  it('returns "decay" for decay sources', () => {
    expect(getRecSourceCategory('decay:blog/my-post')).toBe('decay');
    expect(getRecSourceCategory('decay')).toBe('decay');
  });

  it('returns "insight:ctr_opportunity" for CTR opportunity sources', () => {
    expect(getRecSourceCategory('insight:ctr_opportunity:/plumbing')).toBe('insight:ctr_opportunity');
  });

  it('returns "insight:freshness_alert" for freshness alert sources', () => {
    expect(getRecSourceCategory('insight:freshness_alert:/blog/post')).toBe('insight:freshness_alert');
  });

  it('returns "diagnostic" for diagnostic sources', () => {
    expect(getRecSourceCategory('diagnostic:rpt123:0:Fix title tag')).toBe('diagnostic');
  });

  it('returns null for unknown/rogue source strings', () => {
    expect(getRecSourceCategory('unknown:foo')).toBeNull();
    expect(getRecSourceCategory('')).toBeNull();
    expect(getRecSourceCategory('random')).toBeNull();
  });
});

// ─── RecSource builders ───────────────────────────────────────────────────────

describe('RecSource', () => {
  it('audit() produces "audit:<check>"', () => {
    expect(RecSource.audit('title')).toBe('audit:title');
  });

  it('auditSiteWide() produces "audit:site-wide:<check>"', () => {
    expect(RecSource.auditSiteWide('ssl')).toBe('audit:site-wide:ssl');
  });

  it('strategyContentGap() is stable', () => {
    expect(RecSource.strategyContentGap()).toBe('strategy:content-gap');
  });

  it('strategyQuickWin() is stable', () => {
    expect(RecSource.strategyQuickWin()).toBe('strategy:quick-win');
  });

  it('strategyRankingOpp() is stable', () => {
    expect(RecSource.strategyRankingOpp()).toBe('strategy:ranking-opportunity');
  });

  it('strategyIntentMismatch() embeds the page slug', () => {
    expect(RecSource.strategyIntentMismatch('services/plumbing')).toBe('strategy:intent-mismatch:services/plumbing');
  });

  it('decay() embeds the page slug', () => {
    expect(RecSource.decay('blog/my-post')).toBe('decay:blog/my-post');
  });

  it('ctrOpportunity() embeds the page slug', () => {
    expect(RecSource.ctrOpportunity('plumbing')).toBe('insight:ctr_opportunity:plumbing');
  });

  it('freshnessAlert() embeds the page slug', () => {
    expect(RecSource.freshnessAlert('blog/old-post')).toBe('insight:freshness_alert:blog/old-post');
  });

  it('diagnostic() embeds report id, action index, and truncated title', () => {
    const src = RecSource.diagnostic('rpt_abc123', 2, 'Fix the title tag on homepage');
    expect(src).toBe('diagnostic:rpt_abc123:2:Fix the title tag on');
  });

  it('diagnostic() truncates action title to 20 chars', () => {
    const longTitle = 'A'.repeat(30);
    const src = RecSource.diagnostic('rpt_xyz', 0, longTitle);
    expect(src).toBe(`diagnostic:rpt_xyz:0:${'A'.repeat(20)}`);
  });
});

// ─── toPageSlug ──────────────────────────────────────────────────────────────

describe('toPageSlug', () => {
  it('strips leading slash from relative paths', () => {
    expect(toPageSlug('/plumbing')).toBe('plumbing');
  });

  it('returns bare slug unchanged', () => {
    expect(toPageSlug('plumbing')).toBe('plumbing');
  });

  it('extracts pathname from absolute URLs', () => {
    expect(toPageSlug('https://example.com/blog/my-post')).toBe('blog/my-post');
  });

  it('handles absolute URLs with trailing slash (normalizePageUrl strips it)', () => {
    // normalizePageUrl from helpers trims trailing slash
    const result = toPageSlug('https://example.com/blog/');
    expect(result).toBe('blog');
  });

  it('returns empty string for root path', () => {
    expect(toPageSlug('/')).toBe('');
    expect(toPageSlug('https://example.com/')).toBe('');
  });

  it('handles malformed absolute URLs gracefully (falls through)', () => {
    // Starts with "http" but is not parseable as a URL — falls through to normalizePageUrl
    const result = toPageSlug('http://');
    // Should not throw; result is a string
    expect(typeof result).toBe('string');
  });
});

// ─── migrateSourceKey ────────────────────────────────────────────────────────

describe('migrateSourceKey', () => {
  it('returns source unchanged when it has no URL-slug prefix', () => {
    expect(migrateSourceKey('audit:title')).toBe('audit:title');
    expect(migrateSourceKey('strategy:quick-win')).toBe('strategy:quick-win');
  });

  it('normalizes absolute URL slug in "decay:" prefix', () => {
    const old = 'decay:https://example.com/blog/my-post';
    const normalized = migrateSourceKey(old);
    expect(normalized).toBe('decay:blog/my-post');
  });

  it('normalizes absolute URL slug in "insight:ctr_opportunity:" prefix', () => {
    const old = 'insight:ctr_opportunity:https://example.com/plumbing';
    const normalized = migrateSourceKey(old);
    expect(normalized).toBe('insight:ctr_opportunity:plumbing');
  });

  it('normalizes absolute URL slug in "insight:freshness_alert:" prefix', () => {
    const old = 'insight:freshness_alert:https://example.com/blog/post';
    const normalized = migrateSourceKey(old);
    expect(normalized).toBe('insight:freshness_alert:blog/post');
  });

  it('normalizes absolute URL slug in "strategy:intent-mismatch:" prefix', () => {
    const old = 'strategy:intent-mismatch:https://example.com/services/hvac';
    const normalized = migrateSourceKey(old);
    expect(normalized).toBe('strategy:intent-mismatch:services/hvac');
  });

  it('returns already-normalized slug sources unchanged', () => {
    expect(migrateSourceKey('decay:blog/my-post')).toBe('decay:blog/my-post');
    expect(migrateSourceKey('insight:ctr_opportunity:plumbing')).toBe('insight:ctr_opportunity:plumbing');
  });
});

// ─── buildMergeKey ────────────────────────────────────────────────────────────

describe('buildMergeKey', () => {
  it('returns source for non-strategy recs', () => {
    const rec = { source: 'audit:title', affectedPages: ['/plumbing'], title: 'Title' };
    expect(buildMergeKey(rec)).toBe('audit:title');
  });

  it('returns source::slug for strategy recs with affectedPages', () => {
    const rec = { source: 'strategy:content-gap', affectedPages: ['/blog/hvac'], title: 'Title' };
    expect(buildMergeKey(rec)).toBe('strategy:content-gap::blog/hvac');
  });

  it('falls back to title when strategy rec has no affectedPages', () => {
    const rec = { source: 'strategy:content-gap', affectedPages: [], title: 'Target Content' };
    expect(buildMergeKey(rec)).toBe('strategy:content-gap::Target Content');
  });

  it('normalizes old absolute-URL slugs in strategy rec affectedPages', () => {
    const rec = {
      source: 'strategy:content-gap',
      affectedPages: ['https://example.com/blog/hvac'],
      title: 'Title',
    };
    expect(buildMergeKey(rec)).toBe('strategy:content-gap::blog/hvac');
  });

  it('migrates old absolute-URL in source prefix (decay: example)', () => {
    const rec = {
      source: 'decay:https://example.com/blog/old-post',
      affectedPages: [],
      title: 'Old Post',
    };
    expect(buildMergeKey(rec)).toBe('decay:blog/old-post');
  });
});

// ─── pageImportanceMultiplier ────────────────────────────────────────────────

describe('pageImportanceMultiplier', () => {
  it('returns 1.5 for homepage (empty slug)', () => {
    expect(pageImportanceMultiplier('')).toBe(1.5);
  });

  it('returns 1.5 for "index" slug', () => {
    expect(pageImportanceMultiplier('index')).toBe(1.5);
  });

  it('returns 1.5 for "home" slug', () => {
    expect(pageImportanceMultiplier('home')).toBe(1.5);
  });

  it('returns 1.2 for service pages', () => {
    expect(pageImportanceMultiplier('services/plumbing')).toBe(1.2);
    expect(pageImportanceMultiplier('solutions/hvac')).toBe(1.2);
    expect(pageImportanceMultiplier('pricing')).toBe(1.2);
    expect(pageImportanceMultiplier('packages')).toBe(1.2);
  });

  it('returns 0.8 for thank-you / confirmation pages', () => {
    expect(pageImportanceMultiplier('thank-you')).toBe(0.8);
    expect(pageImportanceMultiplier('confirmation')).toBe(0.8);
    expect(pageImportanceMultiplier('success')).toBe(0.8);
    expect(pageImportanceMultiplier('unsubscribe')).toBe(0.8);
  });

  it('returns 1.0 for ordinary pages', () => {
    expect(pageImportanceMultiplier('blog/tips')).toBe(1.0);
    expect(pageImportanceMultiplier('about')).toBe(1.0);
    expect(pageImportanceMultiplier('contact')).toBe(1.0);
  });

  it('strips leading slash before matching', () => {
    expect(pageImportanceMultiplier('/services/plumbing')).toBe(1.2);
    expect(pageImportanceMultiplier('/')).toBe(1.5); // → '' after strip
  });
});

// ─── checkToRecType ──────────────────────────────────────────────────────────

describe('checkToRecType', () => {
  it('returns "aeo" for aeo- prefixed checks', () => {
    expect(checkToRecType('aeo-author')).toBe('aeo');
    expect(checkToRecType('aeo-answer-first')).toBe('aeo');
    expect(checkToRecType('aeo-trust-pages')).toBe('aeo');
  });

  it('returns "metadata" for meta/title/description checks', () => {
    expect(checkToRecType('title')).toBe('metadata');
    expect(checkToRecType('meta-description')).toBe('metadata');
    expect(checkToRecType('duplicate-title')).toBe('metadata');
    expect(checkToRecType('duplicate-description')).toBe('metadata');
  });

  it('returns "schema" for schema/structured checks', () => {
    expect(checkToRecType('structured-data')).toBe('schema');
    expect(checkToRecType('schema-markup')).toBe('schema');
  });

  it('returns "accessibility" for img-alt/alt checks', () => {
    expect(checkToRecType('img-alt')).toBe('accessibility');
    expect(checkToRecType('alt-tags')).toBe('accessibility');
  });

  it('returns "performance" for cwv/performance/speed checks', () => {
    expect(checkToRecType('cwv-lcp')).toBe('performance');
    expect(checkToRecType('performance-issues')).toBe('performance');
    expect(checkToRecType('page-speed')).toBe('performance');
  });

  it('returns "content" when category is "content"', () => {
    expect(checkToRecType('content-length', 'content')).toBe('content');
    expect(checkToRecType('some-check', 'content')).toBe('content');
  });

  it('returns "technical" for other checks without category', () => {
    expect(checkToRecType('canonical')).toBe('technical');
    expect(checkToRecType('robots')).toBe('technical');
    expect(checkToRecType('redirect-chains')).toBe('technical');
    expect(checkToRecType('ssl')).toBe('technical');
  });

  it('aeo check takes priority over category override', () => {
    // aeo- prefix is first match in chain — even if category were passed it wins
    expect(checkToRecType('aeo-author', 'content')).toBe('aeo');
  });
});

// ─── mapToProduct ─────────────────────────────────────────────────────────────

describe('mapToProduct', () => {
  describe('metadata', () => {
    it('returns fix_meta for < 10 pages', () => {
      const p = mapToProduct('metadata', 5);
      expect(p.productType).toBe('fix_meta');
      expect(p.productPrice).toBe(20);
    });

    it('returns fix_meta_10 for >= 10 pages', () => {
      const p = mapToProduct('metadata', 10);
      expect(p.productType).toBe('fix_meta_10');
      expect(p.productPrice).toBe(179);
    });
  });

  describe('schema', () => {
    it('returns schema_page for < 10 pages', () => {
      const p = mapToProduct('schema', 1);
      expect(p.productType).toBe('schema_page');
      expect(p.productPrice).toBe(39);
    });

    it('returns schema_10 for >= 10 pages', () => {
      const p = mapToProduct('schema', 15);
      expect(p.productType).toBe('schema_10');
      expect(p.productPrice).toBe(299);
    });
  });

  describe('accessibility', () => {
    it('returns fix_alt with fixed price', () => {
      const p = mapToProduct('accessibility', 1);
      expect(p.productType).toBe('fix_alt');
      expect(p.productPrice).toBe(50);
    });
  });

  describe('aeo', () => {
    it('returns aeo_page_review for < 5 pages', () => {
      const p = mapToProduct('aeo', 3);
      expect(p.productType).toBe('aeo_page_review');
      expect(p.productPrice).toBe(99);
    });

    it('returns aeo_site_review for >= 5 pages', () => {
      const p = mapToProduct('aeo', 5);
      expect(p.productType).toBe('aeo_site_review');
      expect(p.productPrice).toBe(499);
    });
  });

  describe('content_refresh', () => {
    it('returns content_refresh for < 5 pages', () => {
      const p = mapToProduct('content_refresh', 1);
      expect(p.productType).toBe('content_refresh');
      expect(p.productPrice).toBe(199);
    });

    it('returns content_refresh_5 for >= 5 pages', () => {
      const p = mapToProduct('content_refresh', 5);
      expect(p.productType).toBe('content_refresh_5');
      expect(p.productPrice).toBe(799);
    });
  });

  describe('other types', () => {
    it('returns empty object for technical type', () => {
      const p = mapToProduct('technical', 1);
      expect(p.productType).toBeUndefined();
      expect(p.productPrice).toBeUndefined();
    });

    it('returns empty object for strategy type', () => {
      const p = mapToProduct('strategy', 1);
      expect(p.productType).toBeUndefined();
    });

    it('returns empty object for performance type', () => {
      const p = mapToProduct('performance', 1);
      expect(p.productType).toBeUndefined();
    });
  });
});

// ─── inferSchemaTypes ────────────────────────────────────────────────────────

describe('inferSchemaTypes', () => {
  it('returns "WebPage" for slugs with no recognizable pattern', () => {
    // Note: 'about' matches Organization, 'contact-us' matches ContactPoint
    // so truly unrecognizable slugs are needed here
    expect(inferSchemaTypes(['archive', 'sitemap', 'privacy-policy'])).toBe('WebPage');
  });

  it('matches "about" as Organization and "contact-us" as ContactPoint', () => {
    // Both patterns match — function correctly returns multiple types
    const result = inferSchemaTypes(['about', 'contact-us']);
    expect(result).toContain('Organization');
    expect(result).toContain('ContactPoint');
  });

  it('returns "Article" for blog/article/news slugs', () => {
    expect(inferSchemaTypes(['blog/my-post'])).toBe('Article');
    expect(inferSchemaTypes(['articles/guide'])).toBe('Article');
    expect(inferSchemaTypes(['news/update'])).toBe('Article');
  });

  it('returns "FAQPage" for faq slugs', () => {
    expect(inferSchemaTypes(['faq'])).toBe('FAQPage');
    expect(inferSchemaTypes(['frequently-asked'])).toBe('FAQPage');
  });

  it('returns "Service" for service slugs', () => {
    expect(inferSchemaTypes(['services/plumbing'])).toBe('Service');
    expect(inferSchemaTypes(['solutions/hvac'])).toBe('Service');
  });

  it('returns "Product" for product/shop/store slugs', () => {
    expect(inferSchemaTypes(['products/widget'])).toBe('Product');
    expect(inferSchemaTypes(['shop/item'])).toBe('Product');
    expect(inferSchemaTypes(['store/category'])).toBe('Product');
  });

  it('returns "Organization" for about/team slugs', () => {
    expect(inferSchemaTypes(['about'])).toBe('Organization');
    expect(inferSchemaTypes(['team'])).toBe('Organization');
    expect(inferSchemaTypes(['our-story'])).toBe('Organization');
  });

  it('returns "Review" for review/testimonials slugs', () => {
    expect(inferSchemaTypes(['review'])).toBe('Review');
    expect(inferSchemaTypes(['testimonials'])).toBe('Review');
    expect(inferSchemaTypes(['case-study'])).toBe('Review');
  });

  it('combines multiple types for mixed slug lists', () => {
    const result = inferSchemaTypes(['blog/post', 'services/plumbing', 'faq']);
    expect(result).toContain('Article');
    expect(result).toContain('Service');
    expect(result).toContain('FAQPage');
  });

  it('returns "WebPage" for empty slug array', () => {
    expect(inferSchemaTypes([])).toBe('WebPage');
  });

  it('deduplicates types when multiple slugs map to the same type', () => {
    const result = inferSchemaTypes(['blog/post-1', 'blog/post-2']);
    expect(result).toBe('Article');
  });
});

// ─── computeImpactScore ──────────────────────────────────────────────────────

describe('computeImpactScore', () => {
  it('error severity gives base 60', () => {
    const score = computeImpactScore('error', false, 0, 0);
    expect(score).toBe(60);
  });

  it('warning severity gives base 35', () => {
    const score = computeImpactScore('warning', false, 0, 0);
    expect(score).toBe(35);
  });

  it('info severity gives base 15', () => {
    const score = computeImpactScore('info', false, 0, 0);
    expect(score).toBe(15);
  });

  it('critical check adds +20 bonus', () => {
    const nonCrit = computeImpactScore('error', false, 0, 0);
    const crit = computeImpactScore('error', true, 0, 0);
    expect(crit - nonCrit).toBe(20);
  });

  it('traffic multiplier adds up to 20 for max traffic', () => {
    const score = computeImpactScore('warning', false, 100, 100);
    // 35 + 0 + 20 = 55
    expect(score).toBe(55);
  });

  it('traffic multiplier is 0 when maxTrafficScore is 0', () => {
    const score = computeImpactScore('warning', false, 50, 0);
    expect(score).toBe(35);
  });

  it('caps at 100', () => {
    const score = computeImpactScore('error', true, 1000, 1);
    expect(score).toBe(100);
  });

  it('partial traffic gives proportional multiplier', () => {
    // 50% of max → +10 traffic bonus; error + critical = 80; + 10 = 90
    const score = computeImpactScore('error', true, 50, 100);
    expect(score).toBe(90);
  });
});

// ─── determinePriority ───────────────────────────────────────────────────────

describe('determinePriority', () => {
  it('returns "fix_now" for impact score >= 70', () => {
    expect(determinePriority(70, 'warning', 0)).toBe('fix_now');
    expect(determinePriority(100, 'info', 0)).toBe('fix_now');
  });

  it('returns "fix_now" for error severity with traffic > 0', () => {
    expect(determinePriority(50, 'error', 100)).toBe('fix_now');
    expect(determinePriority(30, 'error', 1)).toBe('fix_now');
  });

  it('returns "fix_soon" for impact score 45-69', () => {
    expect(determinePriority(45, 'warning', 0)).toBe('fix_soon');
    expect(determinePriority(69, 'info', 0)).toBe('fix_soon');
  });

  it('returns "fix_soon" for error severity with zero traffic (impact < 70)', () => {
    // error with no traffic and score < 70: impactScore < 70 so first check fails,
    // second check: error with trafficScore=0 fails, then impactScore >= 45 may apply
    // score=60 with error, trafficScore=0: 60 < 70, not (error AND traffic>0), 60>=45 → fix_soon
    expect(determinePriority(60, 'error', 0)).toBe('fix_soon');
  });

  it('returns "fix_soon" for pure error severity regardless of impact score (second clause)', () => {
    // impact=30 < 45, but severity=error → fix_soon
    expect(determinePriority(30, 'error', 0)).toBe('fix_soon');
  });

  it('returns "fix_later" for impact score 20-44 with non-error severity', () => {
    expect(determinePriority(20, 'warning', 0)).toBe('fix_later');
    expect(determinePriority(44, 'info', 0)).toBe('fix_later');
  });

  it('returns "fix_later" for impact score below 20', () => {
    expect(determinePriority(10, 'info', 0)).toBe('fix_later');
    expect(determinePriority(0, 'warning', 0)).toBe('fix_later');
  });
});

// ─── inferPageType (extended cases) ──────────────────────────────────────────

describe('inferPageType — extended cases', () => {
  it('detects news/posts slugs as blog', () => {
    expect(inferPageType('news/announcement')).toBe('blog');
    expect(inferPageType('posts/latest')).toBe('blog');
    expect(inferPageType('guides/beginners')).toBe('blog');
  });

  it('detects product/shop/store pages', () => {
    expect(inferPageType('products/widget')).toBe('product');
    expect(inferPageType('shop/item')).toBe('product');
    expect(inferPageType('store/category')).toBe('product');
  });

  it('detects landing pages', () => {
    expect(inferPageType('landing/promo')).toBe('landing');
    expect(inferPageType('lp-summer-deal')).toBe('landing');
  });

  it('detects offerings as service', () => {
    expect(inferPageType('offerings/consulting')).toBe('service');
  });

  it('returns "other" for about/team/contact pages', () => {
    expect(inferPageType('about')).toBe('other');
    expect(inferPageType('contact')).toBe('other');
    expect(inferPageType('team')).toBe('other');
  });

  it('is case-insensitive', () => {
    expect(inferPageType('BLOG/MyPost')).toBe('blog');
    expect(inferPageType('SERVICES/Plumbing')).toBe('service');
  });
});

// ─── isIntentMismatch (extended cases) ───────────────────────────────────────

describe('isIntentMismatch — product page case', () => {
  it('flags product pages targeting informational intent', () => {
    const r = isIntentMismatch('product', 'informational');
    expect(r.mismatch).toBe(true);
    expect(r.reason).toContain('blog post');
    expect(r.reason).toContain('product');
  });

  it('does not flag product pages targeting transactional intent', () => {
    expect(isIntentMismatch('product', 'transactional').mismatch).toBe(false);
    expect(isIntentMismatch('product', 'commercial').mismatch).toBe(false);
  });

  it('does not flag other/landing pages for any intent', () => {
    expect(isIntentMismatch('other', 'informational').mismatch).toBe(false);
    expect(isIntentMismatch('landing', 'transactional').mismatch).toBe(false);
  });

  it('does not flag blog targeting informational intent', () => {
    expect(isIntentMismatch('blog', 'informational').mismatch).toBe(false);
  });
});

describe('recommendation persistence integrity', () => {
  it('round-trips persisted recommendation sets without data loss', () => {
    const workspaceId = makeWorkspaceId('ws_rec_roundtrip');
    recWorkspaceIds.add(workspaceId);
    const set = makeRecommendationSet(workspaceId);

    saveRecommendations(set);
    const loaded = loadRecommendations(workspaceId);

    expect(loaded).toEqual(set);
  });

  it('updates only the targeted recommendation status and persists updatedAt', () => {
    const workspaceId = makeWorkspaceId('ws_rec_status');
    recWorkspaceIds.add(workspaceId);
    const set = makeRecommendationSet(workspaceId);
    saveRecommendations(set);

    const updated = updateRecommendationStatus(workspaceId, 'rec-1', 'completed');
    expect(updated).toBeDefined();
    expect(updated?.status).toBe('completed');
    expect(updated?.updatedAt).toEqual(expect.any(String));

    const loaded = loadRecommendations(workspaceId);
    expect(loaded?.recommendations.find((rec) => rec.id === 'rec-1')?.status).toBe('completed');
    expect(loaded?.recommendations.find((rec) => rec.id === 'rec-2')?.status).toBe('in_progress');
  });

  it('falls back gracefully when stored recommendations/summary JSON is malformed', () => {
    const workspaceId = makeWorkspaceId('ws_rec_corrupt');
    recWorkspaceIds.add(workspaceId);
    const set = makeRecommendationSet(workspaceId);
    saveRecommendations(set);

    db.prepare(
      'UPDATE recommendation_sets SET recommendations = ?, summary = ? WHERE workspace_id = ?',
    ).run(
      '{"broken"',
      '{"broken"',
      workspaceId,
    );

    const loaded = loadRecommendations(workspaceId);
    expect(loaded).toBeDefined();
    expect(loaded?.recommendations).toEqual([]);
    expect(loaded?.summary).toEqual({
      fixNow: 0,
      fixSoon: 0,
      fixLater: 0,
      ongoing: 0,
      totalImpactScore: 0,
      trafficAtRisk: 0,
      estimatedRecoverableClicks: 0,
      estimatedRecoverableImpressions: 0,
    });
  });

  it('keeps valid recommendations when one stored item is malformed', () => {
    const workspaceId = makeWorkspaceId('ws_rec_partial');
    recWorkspaceIds.add(workspaceId);
    const set = makeRecommendationSet(workspaceId);
    saveRecommendations(set);

    const row = db.prepare('SELECT recommendations FROM recommendation_sets WHERE workspace_id = ?')
      .get(workspaceId) as { recommendations: string } | undefined;
    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.recommendations) as Array<Record<string, unknown>>;
    const mixed = [
      parsed[0],
      { ...parsed[1], impactScore: 'not-a-number' },
    ];
    db.prepare('UPDATE recommendation_sets SET recommendations = ? WHERE workspace_id = ?')
      .run(JSON.stringify(mixed), workspaceId);

    const loaded = loadRecommendations(workspaceId);
    expect(loaded?.recommendations).toHaveLength(1);
    expect(loaded?.recommendations[0].id).toBe('rec-1');
  });

  it('dismissRecommendation returns false for unknown recommendation ids', () => {
    const workspaceId = makeWorkspaceId('ws_rec_missing');
    recWorkspaceIds.add(workspaceId);
    saveRecommendations(makeRecommendationSet(workspaceId));

    expect(dismissRecommendation(workspaceId, 'nope')).toBe(false);
  });
});
