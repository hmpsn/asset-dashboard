/**
 * Unit tests for workspace config Zod validation schemas.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseJsonSafe } from '../../server/db/json-validation.js';
import {
  eventDisplayConfigArraySchema, eventGroupArraySchema,
  keywordStrategySchema, competitorDomainsSchema, personasArraySchema,
  contentPricingSchema, portalContactsArraySchema, auditSuppressionsArraySchema,
  publishTargetSchema, businessProfileSchema,
} from '../../server/schemas/workspace-schemas.js';

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(),
  }),
}));

describe('eventDisplayConfigArraySchema', () => {
  it('parses valid event configs', () => {
    const data = [{ eventName: 'page_view', displayName: 'Page Views', pinned: true }];
    const result = parseJsonSafe(JSON.stringify(data), eventDisplayConfigArraySchema, []);
    expect(result).toHaveLength(1);
    expect(result[0].eventName).toBe('page_view');
  });

  it('returns fallback for wrong types', () => {
    expect(parseJsonSafe(JSON.stringify([{ eventName: 123 }]), eventDisplayConfigArraySchema, [])).toEqual([]);
  });
});

describe('keywordStrategySchema', () => {
  const fallback = { siteKeywords: [], pageMap: [], opportunities: [] };

  it('parses valid keyword strategy', () => {
    const data = {
      siteKeywords: ['seo'],
      pageMap: [{ pagePath: '/', pageTitle: 'Home', primaryKeyword: 'seo', secondaryKeywords: ['sem'] }],
      opportunities: ['content marketing'],
    };
    const result = parseJsonSafe(JSON.stringify(data), keywordStrategySchema, fallback);
    expect(result.siteKeywords).toEqual(['seo']);
    expect(result.pageMap).toHaveLength(1);
  });

  it('allows extra fields via passthrough', () => {
    const data = { siteKeywords: [], pageMap: [], opportunities: [], quickWins: [{ keyword: 'test' }] };
    const result = parseJsonSafe(JSON.stringify(data), keywordStrategySchema, fallback);
    expect((result as any).quickWins).toBeDefined();
  });

  it('returns fallback for missing required fields', () => {
    const result = parseJsonSafe(JSON.stringify({ siteKeywords: [] }), keywordStrategySchema, fallback);
    expect(result).toBe(fallback);
  });
});

describe('personasArraySchema', () => {
  it('parses valid persona', () => {
    const data = [{
      id: 'p1', name: 'SMB Owner', description: 'Small business owner',
      painPoints: ['budget'], goals: ['grow online'], objections: ['cost'],
    }];
    const result = parseJsonSafe(JSON.stringify(data), personasArraySchema, []);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('SMB Owner');
  });
});

describe('contentPricingSchema', () => {
  const fallback = { briefPrice: 0, fullPostPrice: 0, currency: 'USD' };

  it('parses valid pricing', () => {
    const data = { briefPrice: 150, fullPostPrice: 500, currency: 'USD' };
    const result = parseJsonSafe(JSON.stringify(data), contentPricingSchema, fallback);
    expect(result.briefPrice).toBe(150);
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

describe('competitorDomainsSchema', () => {
  it('parses string array', () => {
    const result = parseJsonSafe(JSON.stringify(['competitor.com']), competitorDomainsSchema, []);
    expect(result).toEqual(['competitor.com']);
  });

  it('returns fallback for non-strings', () => {
    expect(parseJsonSafe(JSON.stringify([123]), competitorDomainsSchema, [])).toEqual([]);
  });
});
