/**
 * Pure-logic unit tests for server/recommendations.ts
 *
 * Covers: getRecoveryRate, migrateSourceKey, buildMergeKey, pageImportanceMultiplier,
 * checkToRecType, mapToProduct, auditInsight, getTrafficScore (base formula)
 *
 * The functions under test are pure / non-async / non-DB. The product-catalog
 * helpers imported from server/stripe.js (isProductType, getProductConfig) are
 * likewise static lookups over PRODUCT_MAP — the Stripe client is constructed
 * lazily, so importing them here does not touch the DB or open a connection.
 */
import { describe, it, expect } from 'vitest';
import { isProductType, getProductConfig } from '../../server/stripe.js';
import type { RecType } from '../../shared/types/recommendations.js';
import type { ContentGap } from '../../shared/types/workspace.js';
import {
  getRecoveryRate,
  migrateSourceKey,
  buildMergeKey,
  pageImportanceMultiplier,
  checkToRecType,
  mapToProduct,
  auditInsight,
  getTrafficScore,
} from '../../server/recommendations.js';

// ─── getRecoveryRate ──────────────────────────────────────────────────────────

describe('getRecoveryRate', () => {
  it('returns the correct rate for "title"', () => {
    const r = getRecoveryRate('title');
    expect(r.perRec).toBe('10-25%');
    expect(r.summary).toBe(0.18);
  });

  it('returns the correct rate for "canonical"', () => {
    const r = getRecoveryRate('canonical');
    expect(r.perRec).toBe('15-30%');
    expect(r.summary).toBe(0.22);
  });

  it('returns the correct rate for "indexability" (high-impact technical)', () => {
    const r = getRecoveryRate('indexability');
    expect(r.perRec).toBe('20-50%');
    expect(r.summary).toBe(0.35);
  });

  it('returns the correct rate for "img-alt" (low-impact)', () => {
    const r = getRecoveryRate('img-alt');
    expect(r.perRec).toBe('2-5%');
    expect(r.summary).toBe(0.03);
  });

  it('returns the correct rate for "structured-data"', () => {
    const r = getRecoveryRate('structured-data');
    expect(r.perRec).toBe('5-15%');
    expect(r.summary).toBe(0.10);
  });

  it('returns the correct rate for "orphan-pages"', () => {
    const r = getRecoveryRate('orphan-pages');
    expect(r.perRec).toBe('10-25%');
    expect(r.summary).toBe(0.18);
  });

  it('falls back to DEFAULT_RECOVERY for unknown check names', () => {
    const r = getRecoveryRate('unknown-check');
    expect(r.perRec).toBe('5-15%');
    expect(r.summary).toBe(0.12);
  });

  it('falls back to DEFAULT_RECOVERY for empty string', () => {
    const r = getRecoveryRate('');
    expect(r.perRec).toBe('5-15%');
    expect(r.summary).toBe(0.12);
  });

  it('returns the correct rate for "cwv"', () => {
    const r = getRecoveryRate('cwv');
    expect(r.perRec).toBe('5-15%');
    expect(r.summary).toBe(0.10);
  });

  it('returns the correct rate for "ssl"', () => {
    const r = getRecoveryRate('ssl');
    expect(r.perRec).toBe('10-20%');
    expect(r.summary).toBe(0.15);
  });

  it('returns the correct rate for "og-tags"', () => {
    const r = getRecoveryRate('og-tags');
    expect(r.perRec).toBe('1-3%');
    expect(r.summary).toBe(0.02);
  });

  it('returns the correct rate for "redirect-chains"', () => {
    const r = getRecoveryRate('redirect-chains');
    expect(r.perRec).toBe('5-15%');
    expect(r.summary).toBe(0.10);
  });
});

// ─── migrateSourceKey ─────────────────────────────────────────────────────────

describe('migrateSourceKey', () => {
  it('returns source unchanged when no prefix matches', () => {
    expect(migrateSourceKey('audit:title')).toBe('audit:title');
    expect(migrateSourceKey('strategy:content-gap')).toBe('strategy:content-gap');
    expect(migrateSourceKey('diagnostic:rep1:0:fix')).toBe('diagnostic:rep1:0:fix');
  });

  it('returns source unchanged when slug is already normalized (no domain, no leading slash)', () => {
    expect(migrateSourceKey('insight:ctr_opportunity:blog/article')).toBe('insight:ctr_opportunity:blog/article');
    expect(migrateSourceKey('decay:services/plumbing')).toBe('decay:services/plumbing');
    expect(migrateSourceKey('insight:freshness_alert:about')).toBe('insight:freshness_alert:about');
    expect(migrateSourceKey('strategy:intent-mismatch:blog/post')).toBe('strategy:intent-mismatch:blog/post');
  });

  it('normalizes ctr_opportunity source with absolute URL slug', () => {
    const result = migrateSourceKey('insight:ctr_opportunity:https://example.com/blog/post');
    expect(result).toBe('insight:ctr_opportunity:blog/post');
  });

  it('normalizes freshness_alert source with absolute URL slug', () => {
    const result = migrateSourceKey('insight:freshness_alert:https://mysite.com/services/hvac');
    expect(result).toBe('insight:freshness_alert:services/hvac');
  });

  it('normalizes decay source with absolute URL slug', () => {
    const result = migrateSourceKey('decay:https://example.com/pricing');
    expect(result).toBe('decay:pricing');
  });

  it('normalizes intent-mismatch source with absolute URL slug', () => {
    const result = migrateSourceKey('strategy:intent-mismatch:https://example.com/blog/guide');
    expect(result).toBe('strategy:intent-mismatch:blog/guide');
  });

  it('strips leading slash from relative slug (ctr_opportunity)', () => {
    // toPageSlug('/blog/article') → normalizePageUrl('/blog/article') = '/blog/article' → strip '/' → 'blog/article'
    // migrateSourceKey only triggers when normalized !== slug, and '/blog/article' !== 'blog/article'
    const result = migrateSourceKey('insight:ctr_opportunity:/blog/article');
    expect(result).toBe('insight:ctr_opportunity:blog/article');
  });

  it('strips leading slash from relative slug (decay)', () => {
    const result = migrateSourceKey('decay:/services/plumbing');
    expect(result).toBe('decay:services/plumbing');
  });

  it('strips leading slash from relative slug (freshness_alert)', () => {
    const result = migrateSourceKey('insight:freshness_alert:/about');
    expect(result).toBe('insight:freshness_alert:about');
  });

  it('strips leading slash from intent-mismatch relative slug', () => {
    const result = migrateSourceKey('strategy:intent-mismatch:/contact');
    expect(result).toBe('strategy:intent-mismatch:contact');
  });

  it('returns source unchanged for empty string', () => {
    expect(migrateSourceKey('')).toBe('');
  });
});

// ─── buildMergeKey ────────────────────────────────────────────────────────────

describe('buildMergeKey', () => {
  it('returns just the source for non-strategy recs', () => {
    const rec = { source: 'audit:title', affectedPages: ['/services'], title: 'Fix Title' };
    expect(buildMergeKey(rec)).toBe('audit:title');
  });

  it('returns just the source for decay recs (non-strategy)', () => {
    const rec = { source: 'decay:blog/article', affectedPages: [], title: 'Refresh Article' };
    expect(buildMergeKey(rec)).toBe('decay:blog/article');
  });

  it('builds composite key for strategy recs with affectedPages', () => {
    const rec = { source: 'strategy:content-gap', affectedPages: ['/blog/post'], title: 'Content Gap' };
    expect(buildMergeKey(rec)).toBe('strategy:content-gap::blog/post');
  });

  it('falls back to rec.title when affectedPages is empty for strategy recs', () => {
    const rec = { source: 'strategy:quick-win', affectedPages: [], title: 'Add FAQ Schema' };
    expect(buildMergeKey(rec)).toBe('strategy:quick-win::Add FAQ Schema');
  });

  it('normalizes absolute URL in affectedPages (strips domain)', () => {
    const rec = {
      source: 'strategy:content-gap',
      affectedPages: ['https://example.com/services/plumbing'],
      title: 'Content Gap',
    };
    expect(buildMergeKey(rec)).toBe('strategy:content-gap::services/plumbing');
  });

  it('normalizes leading slash in affectedPages', () => {
    const rec = {
      source: 'strategy:intent-mismatch:/pricing',
      affectedPages: ['/pricing'],
      title: 'Intent Mismatch',
    };
    // source migration: '/pricing' has leading slash → normalized to 'pricing'
    const result = buildMergeKey(rec);
    expect(result).toContain('::pricing');
  });

  it('applies migrateSourceKey to the source portion of strategy recs', () => {
    const rec = {
      source: 'strategy:intent-mismatch:/blog/article',
      affectedPages: ['/blog/article'],
      title: 'Intent Mismatch',
    };
    const result = buildMergeKey(rec);
    expect(result).toBe('strategy:intent-mismatch:blog/article::blog/article');
  });

  it('applies migrateSourceKey to normalize old ctr_opportunity source (non-strategy)', () => {
    const rec = {
      source: 'insight:ctr_opportunity:/blog/article',
      affectedPages: [],
      title: 'CTR Opportunity',
    };
    // migrateSourceKey normalizes the source, and it's not strategy: so no composite
    expect(buildMergeKey(rec)).toBe('insight:ctr_opportunity:blog/article');
  });
});

// ─── pageImportanceMultiplier ─────────────────────────────────────────────────

describe('pageImportanceMultiplier', () => {
  it('returns 1.5 for homepage — empty string slug', () => {
    expect(pageImportanceMultiplier('')).toBe(1.5);
  });

  it('returns 1.5 for homepage — "/" slug', () => {
    // '/' → replace /^\// → '' → matches s === ''
    expect(pageImportanceMultiplier('/')).toBe(1.5);
  });

  it('returns 1.5 for homepage — "index" slug', () => {
    expect(pageImportanceMultiplier('index')).toBe(1.5);
  });

  it('returns 1.5 for homepage — "home" slug', () => {
    expect(pageImportanceMultiplier('home')).toBe(1.5);
  });

  it('returns 1.2 for "services" slug', () => {
    expect(pageImportanceMultiplier('services')).toBe(1.2);
  });

  it('returns 1.2 for "/services/web-design" slug', () => {
    expect(pageImportanceMultiplier('/services/web-design')).toBe(1.2);
  });

  it('returns 1.2 for "pricing" slug', () => {
    expect(pageImportanceMultiplier('pricing')).toBe(1.2);
  });

  it('returns 1.2 for "packages" slug', () => {
    expect(pageImportanceMultiplier('packages')).toBe(1.2);
  });

  it('returns 0.8 for "thank-you" slug', () => {
    expect(pageImportanceMultiplier('thank-you')).toBe(0.8);
  });

  it('returns 0.8 for "confirmation" slug', () => {
    expect(pageImportanceMultiplier('confirmation')).toBe(0.8);
  });

  it('returns 0.8 for "/success" slug', () => {
    expect(pageImportanceMultiplier('/success')).toBe(0.8);
  });

  it('returns 0.8 for "/members" slug', () => {
    expect(pageImportanceMultiplier('/members')).toBe(0.8);
  });

  it('returns 0.8 for "/password" slug', () => {
    expect(pageImportanceMultiplier('/password')).toBe(0.8);
  });

  it('returns 1.0 for regular blog page', () => {
    expect(pageImportanceMultiplier('blog/seo-tips')).toBe(1.0);
  });

  it('returns 1.0 for about page', () => {
    expect(pageImportanceMultiplier('about')).toBe(1.0);
  });

  it('returns 1.0 for contact page', () => {
    expect(pageImportanceMultiplier('contact')).toBe(1.0);
  });

  it('is case-insensitive (handles uppercase slugs)', () => {
    expect(pageImportanceMultiplier('SERVICES')).toBe(1.2);
    expect(pageImportanceMultiplier('HOME')).toBe(1.5);
  });
});

// ─── checkToRecType ───────────────────────────────────────────────────────────

describe('checkToRecType', () => {
  it('returns "aeo" for aeo-prefixed checks', () => {
    expect(checkToRecType('aeo-author')).toBe('aeo');
    expect(checkToRecType('aeo-faq-no-schema')).toBe('aeo');
    expect(checkToRecType('aeo-answer-first')).toBe('aeo');
  });

  it('returns "metadata" for meta-description check', () => {
    expect(checkToRecType('meta-description')).toBe('metadata');
  });

  it('returns "metadata" for title check', () => {
    expect(checkToRecType('title')).toBe('metadata');
  });

  it('returns "metadata" for duplicate-title check', () => {
    expect(checkToRecType('duplicate-title')).toBe('metadata');
  });

  it('returns "schema" for structured-data check', () => {
    expect(checkToRecType('structured-data')).toBe('schema');
  });

  it('returns "schema" for schema-markup check', () => {
    expect(checkToRecType('schema-markup')).toBe('schema');
  });

  it('returns "accessibility" for img-alt check', () => {
    expect(checkToRecType('img-alt')).toBe('accessibility');
  });

  it('returns "performance" for cwv check', () => {
    expect(checkToRecType('cwv')).toBe('performance');
  });

  it('returns "performance" for cwv-lcp check', () => {
    expect(checkToRecType('cwv-lcp')).toBe('performance');
  });

  it('returns "performance" for performance check', () => {
    expect(checkToRecType('performance')).toBe('performance');
  });

  it('returns "content" when category=content and check does not match specific types', () => {
    expect(checkToRecType('content-length', 'content')).toBe('content');
    expect(checkToRecType('some-check', 'content')).toBe('content');
  });

  it('returns "technical" as fallback with no category match', () => {
    expect(checkToRecType('robots')).toBe('technical');
    expect(checkToRecType('canonical')).toBe('technical');
    expect(checkToRecType('redirect-chains')).toBe('technical');
    expect(checkToRecType('unknown-check')).toBe('technical');
  });

  it('returns "technical" when category is undefined and check is not recognized', () => {
    expect(checkToRecType('sitemap')).toBe('technical');
  });

  it('is case-insensitive for check names', () => {
    expect(checkToRecType('AEO-Author')).toBe('aeo');
    expect(checkToRecType('TITLE')).toBe('metadata');
  });
});

// ─── mapToProduct ─────────────────────────────────────────────────────────────

describe('mapToProduct', () => {
  // ── Checkout-guard contract ────────────────────────────────────────────────
  // Every productType mapToProduct can EVER return must pass isProductType and
  // carry the catalog price — otherwise the rec card renders a purchase CTA
  // that fails at cart checkout (the exact pre-existing bug this pins shut).
  // The Record<RecType, true> forces a typecheck failure when a new RecType is
  // added, so this sweep can never silently go stale.
  it('every returned productType passes isProductType at the catalog price (exhaustive over RecType)', () => {
    const ALL_REC_TYPES: Record<RecType, true> = {
      technical: true, content: true, content_refresh: true, schema: true,
      metadata: true, performance: true, accessibility: true, strategy: true,
      aeo: true, keyword_gap: true, topic_cluster: true, cannibalization: true,
      local_visibility: true, local_service_gap: true,
    };
    const PAGE_COUNTS = [1, 4, 5, 9, 10, 100];
    const PAGE_TYPES: Array<ContentGap['suggestedPageType']> = [
      undefined, 'blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource',
    ];
    let purchasable = 0;
    for (const recType of Object.keys(ALL_REC_TYPES) as RecType[]) {
      for (const pageCount of PAGE_COUNTS) {
        for (const pageType of PAGE_TYPES) {
          const { productType, productPrice } = mapToProduct(recType, pageCount, pageType);
          if (productType === undefined) {
            expect(productPrice).toBeUndefined();
            continue;
          }
          purchasable++;
          expect(isProductType(productType), `${recType}/${pageCount}/${pageType} → ${productType} must be a real ProductType`).toBe(true);
          expect(productPrice, `${recType}/${pageCount}/${pageType} → ${productType} price must match the catalog`).toBe(getProductConfig(productType as Parameters<typeof getProductConfig>[0])!.priceUsd);
        }
      }
    }
    expect(purchasable).toBeGreaterThan(0); // the sweep must exercise real products, not vacuously skip
  });

  it('metadata with pageCount < 10 → fix_meta at $20', () => {
    const r = mapToProduct('metadata', 9);
    expect(r.productType).toBe('fix_meta');
    expect(r.productPrice).toBe(20);
  });

  it('metadata with pageCount = 1 → fix_meta at $20', () => {
    const r = mapToProduct('metadata', 1);
    expect(r.productType).toBe('fix_meta');
    expect(r.productPrice).toBe(20);
  });

  it('metadata with pageCount >= 10 → fix_meta_10 at $179', () => {
    const r = mapToProduct('metadata', 10);
    expect(r.productType).toBe('fix_meta_10');
    expect(r.productPrice).toBe(179);
  });

  it('metadata with pageCount = 100 → fix_meta_10 at $179', () => {
    const r = mapToProduct('metadata', 100);
    expect(r.productType).toBe('fix_meta_10');
    expect(r.productPrice).toBe(179);
  });

  it('schema with pageCount < 10 → schema_page at $39', () => {
    const r = mapToProduct('schema', 5);
    expect(r.productType).toBe('schema_page');
    expect(r.productPrice).toBe(39);
  });

  it('schema with pageCount >= 10 → schema_10 at $299', () => {
    const r = mapToProduct('schema', 10);
    expect(r.productType).toBe('schema_10');
    expect(r.productPrice).toBe(299);
  });

  it('accessibility → fix_alt at $50 regardless of pageCount', () => {
    expect(mapToProduct('accessibility', 1)).toEqual({ productType: 'fix_alt', productPrice: 50 });
    expect(mapToProduct('accessibility', 100)).toEqual({ productType: 'fix_alt', productPrice: 50 });
  });

  // aeo/content_refresh deliberately have NO product: the values they used to
  // return are not in the ProductType union / PRODUCT_MAP, so their CTAs failed
  // isProductType at cart checkout. Re-add cases only with real PRODUCT_MAP entries.
  it('aeo → empty object (no purchasable product in the catalog)', () => {
    expect(mapToProduct('aeo', 4)).toEqual({});
    expect(mapToProduct('aeo', 5)).toEqual({});
  });

  it('content_refresh → empty object (no purchasable product in the catalog)', () => {
    expect(mapToProduct('content_refresh', 3)).toEqual({});
    expect(mapToProduct('content_refresh', 5)).toEqual({});
  });

  it('technical → empty object (no product)', () => {
    expect(mapToProduct('technical', 1)).toEqual({});
    expect(mapToProduct('technical', 50)).toEqual({});
  });

  // D2 (audit #11): content recs map to the existing brief-purchase products so the
  // client CTA routes into the brief-purchase flow instead of dead-ending with no product.
  it('content → brief product keyed by suggested page type (prices mirror PRODUCT_MAP)', () => {
    expect(mapToProduct('content', 1, 'blog')).toEqual({ productType: 'brief_blog', productPrice: 125 });
    expect(mapToProduct('content', 1, 'landing')).toEqual({ productType: 'brief_landing', productPrice: 150 });
    expect(mapToProduct('content', 1, 'service')).toEqual({ productType: 'brief_service', productPrice: 150 });
    expect(mapToProduct('content', 1, 'location')).toEqual({ productType: 'brief_location', productPrice: 150 });
    expect(mapToProduct('content', 1, 'product')).toEqual({ productType: 'brief_product', productPrice: 150 });
    expect(mapToProduct('content', 1, 'pillar')).toEqual({ productType: 'brief_pillar', productPrice: 200 });
    expect(mapToProduct('content', 1, 'resource')).toEqual({ productType: 'brief_resource', productPrice: 150 });
  });

  it('content without a page type → brief_blog default', () => {
    expect(mapToProduct('content', 10)).toEqual({ productType: 'brief_blog', productPrice: 125 });
  });

  it('performance → empty object (no product)', () => {
    expect(mapToProduct('performance', 3)).toEqual({});
  });

  it('metadata threshold is exactly 10 (not 9)', () => {
    expect(mapToProduct('metadata', 9).productType).toBe('fix_meta');
    expect(mapToProduct('metadata', 10).productType).toBe('fix_meta_10');
  });

});

// ─── auditInsight ─────────────────────────────────────────────────────────────

describe('auditInsight', () => {
  it('title with traffic mentions page count and click count', () => {
    const result = auditInsight('title', 'error', 5, 1200);
    expect(result).toContain('5');
    expect(result).toContain('1.2k');
    expect(result).toContain('title');
  });

  it('title without traffic mentions page count but not traffic number', () => {
    const result = auditInsight('title', 'error', 3, 0);
    expect(result).toContain('3');
    expect(result).not.toContain('clicks');
    expect(result).toContain('title');
  });

  it('meta-description with traffic mentions metadata/meta', () => {
    const result = auditInsight('meta-description', 'warning', 4, 500);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('500');
    expect(result.toLowerCase()).toMatch(/meta|description|metadata/);
  });

  it('meta-description without traffic mentions metadata optimization', () => {
    const result = auditInsight('meta-description', 'warning', 2, 0);
    expect(result).toContain('2');
    expect(result.toLowerCase()).toMatch(/meta|description|metadata/);
  });

  it('h1 check includes H1/heading language', () => {
    const result = auditInsight('h1', 'error', 6, 0);
    expect(result).toContain('H1');
    expect(result).toContain('6');
  });

  it('canonical check includes canonical/duplicate content language', () => {
    const result = auditInsight('canonical', 'error', 3, 0);
    expect(result.toLowerCase()).toContain('canonical');
    expect(result.toLowerCase()).toMatch(/duplicate|dilut/);
  });

  it('structured-data with blog slugs infers Article schema type', () => {
    const result = auditInsight('structured-data', 'warning', 2, 0, ['/blog/my-post', '/blog/guide']);
    expect(result).toContain('Article');
  });

  it('structured-data with no slugs does not mention schema types', () => {
    const result = auditInsight('structured-data', 'warning', 2, 0, []);
    expect(result).not.toContain('Recommended types');
  });

  it('structured-data with traffic mentions CTR boost', () => {
    const result = auditInsight('structured-data', 'warning', 3, 800);
    expect(result).toContain('800');
    expect(result.toLowerCase()).toMatch(/rich snippet|ctr/i);
  });

  it('img-alt mentions alt text and accessibility', () => {
    const result = auditInsight('img-alt', 'warning', 10, 0);
    expect(result.toLowerCase()).toMatch(/alt|accessibility/);
    expect(result).toContain('10');
  });

  it('aeo-author with traffic mentions AI/LLMs/credentialed', () => {
    const result = auditInsight('aeo-author', 'warning', 5, 2000);
    expect(result).toContain('5');
    expect(result).toContain('2.0k');
    expect(result.toLowerCase()).toMatch(/ai|llm|author|credentialed/i);
  });

  it('aeo-author without traffic mentions author attribution', () => {
    const result = auditInsight('aeo-author', 'warning', 3, 0);
    expect(result).toContain('3');
    expect(result.toLowerCase()).toMatch(/author|byline/i);
  });

  it('aeo-faq-no-schema reaches its dedicated branch and mentions FAQPage', () => {
    const result = auditInsight('aeo-faq-no-schema', 'info', 2, 0);
    expect(result).toContain('2');
    expect(result).toContain('FAQPage');
  });

  it('cwv with traffic mentions Core Web Vitals and traffic number', () => {
    const result = auditInsight('cwv', 'warning', 7, 3000);
    expect(result.toLowerCase()).toMatch(/core web vitals/i);
    expect(result).toContain('3.0k');
  });

  it('cwv without traffic mentions page speed as ranking factor', () => {
    const result = auditInsight('cwv', 'warning', 4, 0);
    expect(result.toLowerCase()).toMatch(/core web vitals|page speed/i);
  });

  it('trafficAtRisk >= 1000 is formatted as Xk (e.g. 1500 → 1.5k)', () => {
    const result = auditInsight('title', 'error', 1, 1500);
    expect(result).toContain('1.5k');
  });

  it('trafficAtRisk exactly 1000 is formatted as 1.0k', () => {
    const result = auditInsight('title', 'error', 1, 1000);
    expect(result).toContain('1.0k');
  });

  it('trafficAtRisk of 999 is NOT formatted as Xk (uses raw number)', () => {
    const result = auditInsight('title', 'error', 1, 999);
    expect(result).toContain('999');
    // The string does not contain the "Xk" pattern (e.g. "1.5k")
    expect(result).not.toMatch(/\d+\.\d+k/);
  });

  it('unknown check returns a non-empty fallback string', () => {
    const result = auditInsight('some-unknown-check', 'info', 5, 0);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('5');
  });

  it('fallback string is singular for affectedCount=1', () => {
    const result = auditInsight('unknown-check-xyz', 'info', 1, 0);
    // "1 page affected" (not "1 pages")
    expect(result).toMatch(/\b1 page\b/);
  });

  it('fallback string is plural for affectedCount > 1', () => {
    const result = auditInsight('unknown-check-xyz', 'info', 3, 0);
    expect(result).toMatch(/\b3 pages\b/);
  });
});

// ─── getTrafficScore — base formula (no conversion multiplier) ────────────────

describe('getTrafficScore — base formula', () => {
  const traffic = {
    '/blog/post': { clicks: 100, impressions: 2000, pageviews: 50, sessions: 30 },
    '/services':  { clicks: 50,  impressions: 500,  pageviews: 80, sessions: 20 },
  };

  it('returns 0 when slug not in traffic map', () => {
    expect(getTrafficScore(traffic, 'unknown-page')).toBe(0);
    expect(getTrafficScore(traffic, '/missing')).toBe(0);
  });

  it('returns 0 for empty traffic map', () => {
    expect(getTrafficScore({}, '/blog/post')).toBe(0);
  });

  it('computes base score as clicks*2 + impressions*0.1 + pageviews', () => {
    // /blog/post: 100*2 + 2000*0.1 + 50 = 200 + 200 + 50 = 450
    expect(getTrafficScore(traffic, 'blog/post')).toBe(450);
  });

  it('computes base score correctly for /services', () => {
    // 50*2 + 500*0.1 + 80 = 100 + 50 + 80 = 230
    expect(getTrafficScore(traffic, 'services')).toBe(230);
  });

  it('returns base score unchanged when no conversionRate provided', () => {
    expect(getTrafficScore(traffic, 'blog/post', undefined)).toBe(450);
  });

  it('returns base score unchanged when conversionRate <= 2%', () => {
    // conversionRate must be > 2 to apply multiplier
    expect(getTrafficScore(traffic, 'blog/post', 2.0)).toBe(450);
    expect(getTrafficScore(traffic, 'blog/post', 1.5)).toBe(450);
    expect(getTrafficScore(traffic, 'blog/post', 0)).toBe(450);
  });

  it('normalizes slug with leading slash to find the traffic entry', () => {
    // both 'blog/post' and '/blog/post' should resolve to the same entry
    const withSlash = getTrafficScore(traffic, '/blog/post');
    const withoutSlash = getTrafficScore(traffic, 'blog/post');
    expect(withSlash).toBe(withoutSlash);
    expect(withSlash).toBe(450);
  });
});
