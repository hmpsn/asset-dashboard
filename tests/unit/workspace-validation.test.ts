/**
 * Unit tests for workspace config Zod validation schemas.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { parseJsonSafe, parseJsonSafeArray } from '../../server/db/json-validation.js';
import {
  eventDisplayConfigSchema, eventDisplayConfigArraySchema,
  eventGroupSchema, eventGroupArraySchema,
  keywordStrategySchema, competitorDomainsSchema,
  audiencePersonaSchema, personasArraySchema,
  contentPricingSchema,
  portalContactSchema, portalContactsArraySchema,
  auditSuppressionSchema, auditSuppressionsArraySchema,
  publishTargetSchema, businessProfileSchema,
} from '../../server/schemas/workspace-schemas.js';

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(),
  }),
}));

describe('eventDisplayConfigSchema (parseJsonSafeArray — production path)', () => {
  it('parses valid event configs, keeps good items', () => {
    const data = [
      { eventName: 'page_view', displayName: 'Page Views', pinned: true },
      { eventName: 'click', displayName: 'Clicks', pinned: false },
    ];
    const result = parseJsonSafeArray(JSON.stringify(data), eventDisplayConfigSchema);
    expect(result).toHaveLength(2);
    expect(result[0].eventName).toBe('page_view');
  });

  it('filters bad items, keeps good items (per-item behavior)', () => {
    const data = [
      { eventName: 'page_view', displayName: 'Page Views', pinned: true },
      { eventName: 123, displayName: 'Bad', pinned: false }, // eventName must be string
    ];
    const result = parseJsonSafeArray(JSON.stringify(data), eventDisplayConfigSchema);
    expect(result).toHaveLength(1);
    expect(result[0].eventName).toBe('page_view');
  });

  it('returns empty array for wrong types on all items', () => {
    expect(parseJsonSafeArray(JSON.stringify([{ eventName: 123 }]), eventDisplayConfigSchema)).toEqual([]);
  });
});

describe('keywordStrategySchema', () => {
  const fallback = { siteKeywords: [], pageMap: [], opportunities: [] };

  it('parses stored strategy blob (no pageMap — stored in separate table)', () => {
    // This is the real production case: pageMap is stripped before saving
    const data = {
      siteKeywords: ['seo', 'content marketing'],
      opportunities: ['blog posts', 'landing pages'],
      generatedAt: '2026-01-01T00:00:00.000Z',
      quickWins: [{ keyword: 'seo audit', pagePath: '/', effort: 'low', impact: 'high', currentPosition: 8, volume: 1200 }],
    };
    const result = parseJsonSafe(JSON.stringify(data), keywordStrategySchema, fallback);
    expect(result.siteKeywords).toEqual(['seo', 'content marketing']);
    expect(result.pageMap).toBeUndefined(); // optional — not in stored blob
    expect((result as any).generatedAt).toBe('2026-01-01T00:00:00.000Z'); // passthrough
  });

  it('parses strategy with pageMap when present (e.g. from API response)', () => {
    const data = {
      siteKeywords: ['seo'],
      pageMap: [{ pagePath: '/', pageTitle: 'Home', primaryKeyword: 'seo', secondaryKeywords: ['sem'] }],
      opportunities: ['content marketing'],
    };
    const result = parseJsonSafe(JSON.stringify(data), keywordStrategySchema, fallback);
    expect(result.siteKeywords).toEqual(['seo']);
    expect(result.pageMap).toHaveLength(1);
  });

  it('returns fallback when required fields are missing (siteKeywords)', () => {
    const result = parseJsonSafe(JSON.stringify({ opportunities: [] }), keywordStrategySchema, fallback);
    expect(result).toBe(fallback);
  });

  it('returns fallback when required fields are missing (opportunities)', () => {
    const result = parseJsonSafe(JSON.stringify({ siteKeywords: [] }), keywordStrategySchema, fallback);
    expect(result).toBe(fallback);
  });

  it('allows extra fields via passthrough', () => {
    const data = { siteKeywords: [], opportunities: [], quickWins: [{ keyword: 'test' }] };
    const result = parseJsonSafe(JSON.stringify(data), keywordStrategySchema, fallback);
    expect((result as any).quickWins).toBeDefined();
  });
});

describe('audiencePersonaSchema (parseJsonSafeArray — production path)', () => {
  const validPersona = {
    id: 'p1', name: 'SMB Owner', description: 'Small business owner',
    painPoints: ['budget'], goals: ['grow online'], objections: ['cost'],
  };

  it('parses valid personas', () => {
    const result = parseJsonSafeArray(JSON.stringify([validPersona]), audiencePersonaSchema);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('SMB Owner');
  });

  it('filters invalid personas, keeps valid ones', () => {
    const data = [validPersona, { id: 'bad' }]; // second missing required fields
    const result = parseJsonSafeArray(JSON.stringify(data), audiencePersonaSchema);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });
});

describe('contentPricingSchema', () => {
  const fallback = { briefPrice: 0, fullPostPrice: 0, currency: 'USD' };

  it('parses valid pricing', () => {
    const data = { briefPrice: 150, fullPostPrice: 500, currency: 'USD' };
    const result = parseJsonSafe(JSON.stringify(data), contentPricingSchema, fallback);
    expect(result.briefPrice).toBe(150);
  });

  it('parses pricing with optional label fields', () => {
    const data = { briefPrice: 100, fullPostPrice: 300, currency: 'USD', briefLabel: 'SEO Brief', fullPostLabel: 'Full Article' };
    const result = parseJsonSafe(JSON.stringify(data), contentPricingSchema, fallback);
    expect((result as any).briefLabel).toBe('SEO Brief');
  });

  it('returns fallback for wrong types', () => {
    const result = parseJsonSafe(JSON.stringify({ briefPrice: 'free' }), contentPricingSchema, fallback);
    expect(result).toBe(fallback);
  });
});

describe('businessProfileSchema', () => {
  it('parses valid business profile', () => {
    const data = { phone: '555-1234', email: 'info@test.com', address: { city: 'NYC' } };
    const result = parseJsonSafe(JSON.stringify(data), businessProfileSchema, null as any);
    expect(result.phone).toBe('555-1234');
    expect(result.address?.city).toBe('NYC');
  });

  it('parses empty profile (all optional)', () => {
    const result = parseJsonSafe(JSON.stringify({}), businessProfileSchema, null as any);
    expect(result).toBeDefined();
  });
});

describe('competitorDomainsSchema (parseJsonSafeArray — production path)', () => {
  it('parses valid string array', () => {
    const result = parseJsonSafeArray(JSON.stringify(['competitor.com', 'rival.io']), z.string());
    expect(result).toEqual(['competitor.com', 'rival.io']);
  });

  it('filters non-strings, keeps strings', () => {
    const result = parseJsonSafeArray(JSON.stringify(['good.com', 123, null, 'also-good.com']), z.string());
    expect(result).toEqual(['good.com', 'also-good.com']);
  });
});

describe('publishTargetSchema', () => {
  it('parses valid publish target', () => {
    const data = {
      collectionId: 'col-1',
      collectionName: 'Blog',
      fieldMap: { title: 'name', slug: 'slug', body: 'post-body' },
    };
    const result = parseJsonSafe(JSON.stringify(data), publishTargetSchema, null);
    expect(result?.collectionId).toBe('col-1');
    expect(result?.fieldMap.body).toBe('post-body');
  });

  it('parses fieldMap with publishDate field', () => {
    const data = {
      collectionId: 'col-1',
      collectionName: 'Blog',
      fieldMap: { title: 'name', slug: 'slug', body: 'post-body', publishDate: 'publish-on' },
    };
    const result = parseJsonSafe(JSON.stringify(data), publishTargetSchema, null);
    expect(result?.fieldMap.publishDate).toBe('publish-on');
  });

  it('returns null fallback when required fieldMap fields missing', () => {
    const data = { collectionId: 'col-1', collectionName: 'Blog', fieldMap: { title: 'name' } }; // missing slug and body
    const result = parseJsonSafe(JSON.stringify(data), publishTargetSchema, null);
    expect(result).toBeNull();
  });
});
