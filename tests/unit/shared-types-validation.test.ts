/**
 * Unit tests for shared types, constants, and Zod schema validation.
 *
 * Covers:
 *  - shared/scoring.ts — computePageScore edge cases not in scoring.test.ts
 *  - shared/local-seo-location.ts — normalizeLocalSeoCountryName, buildDataForSeoLocationName
 *  - shared/types/background-jobs.ts — helper functions, constants, type guards
 *  - shared/types/feature-flags.ts — FEATURE_FLAGS constants, catalog consistency
 *  - shared/types/keywords.ts — METRICS_SOURCE, KEYWORD_SOURCE_KIND constants
 *  - server/schemas/workspace-schemas.ts — key schemas with valid/invalid inputs
 *  - server/schemas/diagnostics-schemas.ts — rootCauseSchema, remediationActionSchema
 *  - server/schemas/keyword-feedback.ts — keywordFeedbackSchema, contentGapVoteSchema
 *  - server/schemas/voice-calibration.ts — saveVariationFeedbackSchema
 *  - server/schemas/content-schemas.ts — additional schema coverage
 */

import { describe, it, expect } from 'vitest';

// ── shared/scoring.ts ─────────────────────────────────────────────────────────
import {
  computePageScore,
  CRITICAL_CHECKS,
  MODERATE_CHECKS,
} from '../../shared/scoring.js';

describe('CRITICAL_CHECKS constant', () => {
  it('contains expected critical check names', () => {
    expect(CRITICAL_CHECKS.has('title')).toBe(true);
    expect(CRITICAL_CHECKS.has('meta-description')).toBe(true);
    expect(CRITICAL_CHECKS.has('canonical')).toBe(true);
    expect(CRITICAL_CHECKS.has('h1')).toBe(true);
    expect(CRITICAL_CHECKS.has('robots')).toBe(true);
    expect(CRITICAL_CHECKS.has('ssl')).toBe(true);
  });

  it('does not contain non-critical checks', () => {
    expect(CRITICAL_CHECKS.has('img-alt')).toBe(false);
    expect(CRITICAL_CHECKS.has('og-tags')).toBe(false);
    expect(CRITICAL_CHECKS.has('unknown-check')).toBe(false);
  });
});

describe('MODERATE_CHECKS constant', () => {
  it('contains expected moderate check names', () => {
    expect(MODERATE_CHECKS.has('content-length')).toBe(true);
    expect(MODERATE_CHECKS.has('heading-hierarchy')).toBe(true);
    expect(MODERATE_CHECKS.has('img-alt')).toBe(true);
    expect(MODERATE_CHECKS.has('og-tags')).toBe(true);
    expect(MODERATE_CHECKS.has('viewport')).toBe(true);
  });

  it('does not contain critical checks', () => {
    expect(MODERATE_CHECKS.has('title')).toBe(false);
    expect(MODERATE_CHECKS.has('ssl')).toBe(false);
  });
});

describe('computePageScore — additional edge cases', () => {
  it('clamps score to 0 when many critical errors are present', () => {
    const issues = Array.from({ length: 10 }, () => ({ check: 'title', severity: 'error' }));
    expect(computePageScore(issues)).toBe(0);
  });

  it('clamps score to 100 minimum (never goes negative)', () => {
    const issues = Array.from({ length: 20 }, () => ({ check: 'ssl', severity: 'error' }));
    expect(computePageScore(issues)).toBe(0);
  });

  it('accumulates deductions for multiple different issues', () => {
    // title error (−15) + img-alt error (−10) + content-length warning (−3) = 72
    const issues = [
      { check: 'title', severity: 'error' },
      { check: 'img-alt', severity: 'error' },
      { check: 'content-length', severity: 'warning' },
    ];
    expect(computePageScore(issues)).toBe(72);
  });

  it('does not deduct for info severity on critical checks', () => {
    const issues = [{ check: 'title', severity: 'info' }];
    expect(computePageScore(issues)).toBe(100);
  });

  it('does not deduct for info severity on moderate checks', () => {
    const issues = [{ check: 'img-alt', severity: 'info' }];
    expect(computePageScore(issues)).toBe(100);
  });

  it('handles unknown check + unknown severity gracefully (no deduction)', () => {
    const issues = [{ check: 'unknown-future-check', severity: 'unknown' }];
    expect(computePageScore(issues)).toBe(100);
  });

  it('deducts 2 for a minor (non-critical, non-moderate) warning', () => {
    // Independently verify minor warning logic
    const issues = [{ check: 'some-minor-check', severity: 'warning' }];
    expect(computePageScore(issues)).toBe(98);
  });

  it('returns exactly 100 for empty input array', () => {
    expect(computePageScore([])).toBe(100);
  });
});

// ── shared/local-seo-location.ts ──────────────────────────────────────────────
import {
  normalizeLocalSeoCountryName,
  buildDataForSeoLocationName,
} from '../../shared/local-seo-location.js';

describe('normalizeLocalSeoCountryName', () => {
  it('normalizes "us" to "United States"', () => {
    expect(normalizeLocalSeoCountryName('us')).toBe('United States');
  });

  it('normalizes "US" (uppercase) to "United States"', () => {
    expect(normalizeLocalSeoCountryName('US')).toBe('United States');
  });

  it('normalizes "usa" to "United States"', () => {
    expect(normalizeLocalSeoCountryName('usa')).toBe('United States');
  });

  it('normalizes "USA" to "United States"', () => {
    expect(normalizeLocalSeoCountryName('USA')).toBe('United States');
  });

  it('normalizes "u.s." to "United States"', () => {
    expect(normalizeLocalSeoCountryName('u.s.')).toBe('United States');
  });

  it('normalizes "u.s.a." to "United States"', () => {
    expect(normalizeLocalSeoCountryName('u.s.a.')).toBe('United States');
  });

  it('normalizes "united states" to "United States"', () => {
    expect(normalizeLocalSeoCountryName('united states')).toBe('United States');
  });

  it('normalizes "united states of america" to "United States"', () => {
    expect(normalizeLocalSeoCountryName('united states of america')).toBe('United States');
  });

  it('preserves non-US country names unchanged', () => {
    expect(normalizeLocalSeoCountryName('Canada')).toBe('Canada');
    expect(normalizeLocalSeoCountryName('United Kingdom')).toBe('United Kingdom');
    expect(normalizeLocalSeoCountryName('Australia')).toBe('Australia');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeLocalSeoCountryName('  Canada  ')).toBe('Canada');
  });
});

describe('buildDataForSeoLocationName', () => {
  it('returns undefined when city is missing', () => {
    expect(buildDataForSeoLocationName({ stateOrRegion: 'CA', country: 'US' })).toBeUndefined();
  });

  it('returns undefined when country is missing', () => {
    expect(buildDataForSeoLocationName({ city: 'Los Angeles', stateOrRegion: 'CA' })).toBeUndefined();
  });

  it('returns undefined for US city without state', () => {
    expect(buildDataForSeoLocationName({ city: 'Los Angeles', country: 'US' })).toBeUndefined();
  });

  it('formats US city,state,United States correctly', () => {
    expect(buildDataForSeoLocationName({ city: 'Los Angeles', stateOrRegion: 'CA', country: 'US' }))
      .toBe('Los Angeles,California,United States');
  });

  it('expands two-letter US state abbreviation to full name', () => {
    expect(buildDataForSeoLocationName({ city: 'Austin', stateOrRegion: 'TX', country: 'USA' }))
      .toBe('Austin,Texas,United States');
  });

  it('passes through full US state name as-is', () => {
    expect(buildDataForSeoLocationName({ city: 'Seattle', stateOrRegion: 'Washington', country: 'United States' }))
      .toBe('Seattle,Washington,United States');
  });

  it('formats non-US location as city,country', () => {
    expect(buildDataForSeoLocationName({ city: 'Toronto', country: 'Canada' }))
      .toBe('Toronto,Canada');
  });

  it('includes non-US state in country format (city,country, no state)', () => {
    // Non-US countries don't use state in the format
    expect(buildDataForSeoLocationName({ city: 'London', stateOrRegion: 'England', country: 'United Kingdom' }))
      .toBe('London,United Kingdom');
  });

  it('handles null city gracefully — returns undefined', () => {
    expect(buildDataForSeoLocationName({ city: null, stateOrRegion: 'CA', country: 'US' })).toBeUndefined();
  });

  it('handles null country gracefully — returns undefined', () => {
    expect(buildDataForSeoLocationName({ city: 'San Diego', stateOrRegion: 'CA', country: null })).toBeUndefined();
  });

  it('handles empty city string — returns undefined', () => {
    expect(buildDataForSeoLocationName({ city: '  ', stateOrRegion: 'CA', country: 'US' })).toBeUndefined();
  });
});

// ── shared/types/background-jobs.ts ──────────────────────────────────────────
import {
  BACKGROUND_JOB_TYPES,
  BACKGROUND_JOB_METADATA,
  isBackgroundJobType,
  getBackgroundJobMetadata,
  getBackgroundJobLabel,
  isBackgroundJobCancellable,
  isSystemJobType,
} from '../../shared/types/background-jobs.js';

describe('BACKGROUND_JOB_TYPES constants', () => {
  it('defines all expected job type strings', () => {
    expect(BACKGROUND_JOB_TYPES.SEO_AUDIT).toBe('seo-audit');
    expect(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY).toBe('keyword-strategy');
    expect(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION).toBe('content-post-generation');
    expect(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR).toBe('schema-generator');
    expect(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION).toBe('schema-plan-generation');
    expect(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS).toBe('page-analysis');
    expect(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE).toBe('seo-bulk-analyze');
    expect(BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE).toBe('seo-bulk-rewrite');
    expect(BACKGROUND_JOB_TYPES.SEO_BULK_ACCEPT_FIXES).toBe('seo-bulk-accept-fixes');
    expect(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION).toBe('recommendations-generation');
  });
});

describe('isBackgroundJobType', () => {
  it('returns true for all known job type values', () => {
    for (const value of Object.values(BACKGROUND_JOB_TYPES)) {
      expect(isBackgroundJobType(value)).toBe(true);
    }
  });

  it('returns false for unknown strings', () => {
    expect(isBackgroundJobType('unknown-job')).toBe(false);
    expect(isBackgroundJobType('')).toBe(false);
    expect(isBackgroundJobType('seo_audit')).toBe(false); // underscore variant
  });
});

describe('getBackgroundJobMetadata', () => {
  it('returns metadata for a known job type', () => {
    const meta = getBackgroundJobMetadata(BACKGROUND_JOB_TYPES.SEO_AUDIT);
    expect(meta).toBeDefined();
    expect(meta?.label).toBe('SEO Audit');
    expect(meta?.cancellable).toBe(false);
    expect(meta?.resultBehavior).toBe('domain-store-and-result');
  });

  it('returns metadata for schema-generator (cancellable: true)', () => {
    const meta = getBackgroundJobMetadata(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR);
    expect(meta?.cancellable).toBe(true);
  });

  it('returns metadata for schema-plan-generation (cancellable: false)', () => {
    const meta = getBackgroundJobMetadata(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION);
    expect(meta?.cancellable).toBe(false);
    expect(meta?.resultBehavior).toBe('domain-store');
  });

  it('returns undefined for unknown type', () => {
    expect(getBackgroundJobMetadata('not-a-job')).toBeUndefined();
  });
});

describe('getBackgroundJobLabel', () => {
  it('returns human-readable label for known types', () => {
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.SEO_AUDIT)).toBe('SEO Audit');
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY)).toBe('Keyword Strategy');
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION)).toBe('Content Post Generation');
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION)).toBe('Schema Plan Generation');
    expect(getBackgroundJobLabel(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION)).toBe('Recommendations Generation');
  });

  it('falls back to the raw type string for unknown types', () => {
    expect(getBackgroundJobLabel('my-custom-job')).toBe('my-custom-job');
  });
});

describe('isBackgroundJobCancellable', () => {
  it('returns true for cancellable jobs', () => {
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR)).toBe(true);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS)).toBe(true);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION)).toBe(true);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE)).toBe(true);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE)).toBe(true);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH)).toBe(true);
  });

  it('returns false for non-cancellable jobs', () => {
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.SEO_AUDIT)).toBe(false);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY)).toBe(false);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION)).toBe(false);
    expect(isBackgroundJobCancellable(BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION)).toBe(false);
  });

  it('returns true (safe default) for unknown job types', () => {
    expect(isBackgroundJobCancellable('totally-unknown')).toBe(true);
  });
});

describe('isSystemJobType', () => {
  it('returns true only for the cron-originated intelligence-recompute type', () => {
    expect(isSystemJobType(BACKGROUND_JOB_TYPES.INTELLIGENCE_RECOMPUTE)).toBe(true);
  });

  it('returns false for user-originated job types', () => {
    expect(isSystemJobType(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION)).toBe(false);
    expect(isSystemJobType(BACKGROUND_JOB_TYPES.SEO_AUDIT)).toBe(false);
  });

  it('returns false (safe default) for unknown job types', () => {
    expect(isSystemJobType('totally-unknown')).toBe(false);
  });
});

describe('BACKGROUND_JOB_METADATA completeness', () => {
  it('has a metadata entry for every defined job type', () => {
    for (const value of Object.values(BACKGROUND_JOB_TYPES)) {
      expect(BACKGROUND_JOB_METADATA).toHaveProperty(value);
    }
  });

  it('every metadata entry has required fields', () => {
    for (const [key, meta] of Object.entries(BACKGROUND_JOB_METADATA)) {
      expect(typeof meta.label, `${key}.label`).toBe('string');
      expect(typeof meta.description, `${key}.description`).toBe('string');
      expect(typeof meta.cancellable, `${key}.cancellable`).toBe('boolean');
      expect(['user', 'system'], `${key}.class`).toContain(meta.class);
      expect(['ephemeral', 'domain-store', 'domain-store-and-result']).toContain(meta.resultBehavior);
    }
  });
});

// ── shared/types/feature-flags.ts ─────────────────────────────────────────────
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_GROUPS,
  FEATURE_FLAG_ROLLOUT_TARGETS,
  FEATURE_FLAG_AUDIT_CADENCES,
} from '../../shared/types/feature-flags.js';

describe('FEATURE_FLAGS constants', () => {
  it('all flags default to false', () => {
    // keyword-hub was retired at the Phase C cutover (2026-06-11); every remaining
    // flag is dark by default.
    for (const [key, value] of Object.entries(FEATURE_FLAGS)) {
      expect(value, `flag "${key}" default`).toBe(false);
    }
  });

  it('contains expected flag keys', () => {
    expect('keyword-universe-full' in FEATURE_FLAGS).toBe(true);
    expect('smart-placeholders' in FEATURE_FLAGS).toBe(true);
    expect('client-briefing-v2' in FEATURE_FLAGS).toBe(true);
  });
});

describe('FEATURE_FLAG_KEYS', () => {
  it('is an array of all feature flag key strings', () => {
    expect(Array.isArray(FEATURE_FLAG_KEYS)).toBe(true);
    expect(FEATURE_FLAG_KEYS.length).toBeGreaterThan(0);
  });

  it('every key in FEATURE_FLAG_KEYS exists in FEATURE_FLAGS', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      expect(key in FEATURE_FLAGS, `key "${key}" should be in FEATURE_FLAGS`).toBe(true);
    }
  });

  it('FEATURE_FLAG_KEYS length matches FEATURE_FLAGS key count', () => {
    expect(FEATURE_FLAG_KEYS.length).toBe(Object.keys(FEATURE_FLAGS).length);
  });
});

describe('FEATURE_FLAG_CATALOG', () => {
  it('every flag key has a catalog entry', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      expect(key in FEATURE_FLAG_CATALOG, `catalog missing entry for "${key}"`).toBe(true);
    }
  });

  it('every catalog entry has required fields', () => {
    for (const [key, entry] of Object.entries(FEATURE_FLAG_CATALOG)) {
      expect(typeof entry.label, `${key}.label`).toBe('string');
      expect(typeof entry.group, `${key}.group`).toBe('string');
      expect(typeof entry.lifecycle.owner, `${key}.lifecycle.owner`).toBe('string');
      expect(typeof entry.lifecycle.createdAt, `${key}.lifecycle.createdAt`).toBe('string');
    }
  });
});

describe('FEATURE_FLAG_ROLLOUT_TARGETS', () => {
  it('contains expected target values', () => {
    expect(FEATURE_FLAG_ROLLOUT_TARGETS).toContain('staging-validation');
    expect(FEATURE_FLAG_ROLLOUT_TARGETS).toContain('internal-operators');
    expect(FEATURE_FLAG_ROLLOUT_TARGETS).toContain('pilot-clients');
    expect(FEATURE_FLAG_ROLLOUT_TARGETS).toContain('tiered-client-rollout');
    expect(FEATURE_FLAG_ROLLOUT_TARGETS).toContain('all-clients');
  });
});

describe('FEATURE_FLAG_AUDIT_CADENCES', () => {
  it('contains expected cadence values', () => {
    expect(FEATURE_FLAG_AUDIT_CADENCES).toContain('weekly');
    expect(FEATURE_FLAG_AUDIT_CADENCES).toContain('monthly');
    expect(FEATURE_FLAG_AUDIT_CADENCES).toContain('quarterly');
  });
});

describe('FEATURE_FLAG_GROUPS completeness', () => {
  it('every key listed in groups is a valid flag key', () => {
    for (const group of FEATURE_FLAG_GROUPS) {
      for (const key of group.keys) {
        expect(key in FEATURE_FLAGS, `group "${group.label}" references unknown flag "${key}"`).toBe(true);
      }
    }
  });

  it('no flag key appears in multiple groups', () => {
    const seen = new Set<string>();
    for (const group of FEATURE_FLAG_GROUPS) {
      for (const key of group.keys) {
        expect(seen.has(key), `flag "${key}" appears in multiple groups`).toBe(false);
        seen.add(key);
      }
    }
  });
});

// ── shared/types/keywords.ts ──────────────────────────────────────────────────
import {
  METRICS_SOURCE,
  KEYWORD_SOURCE_KIND,
} from '../../shared/types/keywords.js';

describe('METRICS_SOURCE constants', () => {
  it('defines all expected metric source values', () => {
    expect(METRICS_SOURCE.EXACT).toBe('exact');
    expect(METRICS_SOURCE.URL_LEVEL).toBe('url_level');
    expect(METRICS_SOURCE.PARTIAL_MATCH).toBe('partial_match');
    expect(METRICS_SOURCE.BULK_LOOKUP).toBe('bulk_lookup');
    expect(METRICS_SOURCE.AI_ESTIMATE).toBe('ai_estimate');
  });

  it('has exactly 5 entries', () => {
    expect(Object.keys(METRICS_SOURCE).length).toBe(5);
  });
});

describe('KEYWORD_SOURCE_KIND constants', () => {
  it('defines expected source kind values', () => {
    expect(KEYWORD_SOURCE_KIND.KEYWORD_IDEAS).toBe('keyword_ideas');
    expect(KEYWORD_SOURCE_KIND.GSC_QUERY).toBe('gsc_query');
    expect(KEYWORD_SOURCE_KIND.CLIENT_REQUESTED).toBe('client_requested');
    expect(KEYWORD_SOURCE_KIND.RANKED_KEYWORDS).toBe('ranked_keywords');
    expect(KEYWORD_SOURCE_KIND.UNKNOWN).toBe('unknown');
  });

  it('has all expected kinds', () => {
    const kinds = Object.values(KEYWORD_SOURCE_KIND);
    expect(kinds).toContain('keyword_ideas');
    expect(kinds).toContain('keywords_for_site');
    expect(kinds).toContain('keyword_suggestions');
    expect(kinds).toContain('related_keywords');
    expect(kinds).toContain('gsc_query');
    expect(kinds).toContain('client_requested');
    expect(kinds).toContain('unknown');
  });
});

// ── server/schemas/workspace-schemas.ts — key schemas ────────────────────────
import {
  eventDisplayConfigSchema,
  eventDisplayConfigArraySchema,
  eventGroupSchema,
  eventGroupArraySchema,
  audiencePersonaSchema,
  personasArraySchema,
  contentPricingSchema,
  businessProfileSchema,
  intelligenceProfileSchema,
  competitorDomainsSchema,
  auditSuppressionSchema,
  auditSuppressionsArraySchema,
  recommendationSchema,
} from '../../server/schemas/workspace-schemas.js';

describe('eventDisplayConfigSchema', () => {
  const validEvent = {
    eventName: 'purchase',
    displayName: 'Purchase',
    pinned: true,
  };

  it('accepts valid event config', () => {
    expect(eventDisplayConfigSchema.safeParse(validEvent).success).toBe(true);
  });

  it('accepts event config with optional group', () => {
    expect(eventDisplayConfigSchema.safeParse({ ...validEvent, group: 'conversions' }).success).toBe(true);
  });

  it('rejects missing eventName', () => {
    const { eventName: _, ...rest } = validEvent;
    expect(eventDisplayConfigSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing displayName', () => {
    const { displayName: _, ...rest } = validEvent;
    expect(eventDisplayConfigSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-boolean pinned', () => {
    expect(eventDisplayConfigSchema.safeParse({ ...validEvent, pinned: 'yes' }).success).toBe(false);
  });

  it('validates array of event display configs', () => {
    expect(eventDisplayConfigArraySchema.safeParse([validEvent]).success).toBe(true);
    expect(eventDisplayConfigArraySchema.safeParse([]).success).toBe(true);
  });
});

describe('eventGroupSchema', () => {
  const validGroup = {
    id: 'grp-1',
    name: 'Conversions',
    order: 1,
    color: '#3B82F6',
  };

  it('accepts valid event group', () => {
    expect(eventGroupSchema.safeParse(validGroup).success).toBe(true);
  });

  it('accepts event group with optional fields', () => {
    expect(eventGroupSchema.safeParse({
      ...validGroup,
      defaultPageFilter: '/checkout',
      allowedPages: ['/checkout', '/confirmation'],
    }).success).toBe(true);
  });

  it('rejects missing id', () => {
    const { id: _, ...rest } = validGroup;
    expect(eventGroupSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-numeric order', () => {
    expect(eventGroupSchema.safeParse({ ...validGroup, order: 'first' }).success).toBe(false);
  });

  it('validates array of event groups', () => {
    expect(eventGroupArraySchema.safeParse([validGroup]).success).toBe(true);
  });
});

describe('audiencePersonaSchema', () => {
  const validPersona = {
    id: 'p-1',
    name: 'Marketing Manager',
    description: 'Mid-level marketing professional',
    painPoints: ['Limited budget', 'Hard to measure ROI'],
    goals: ['Grow organic traffic', 'Improve brand visibility'],
    objections: ['Not sure SEO works', 'Too expensive'],
  };

  it('accepts a valid persona', () => {
    expect(audiencePersonaSchema.safeParse(validPersona).success).toBe(true);
  });

  it('accepts persona with optional buyingStage', () => {
    expect(audiencePersonaSchema.safeParse({ ...validPersona, buyingStage: 'awareness' }).success).toBe(true);
    expect(audiencePersonaSchema.safeParse({ ...validPersona, buyingStage: 'consideration' }).success).toBe(true);
    expect(audiencePersonaSchema.safeParse({ ...validPersona, buyingStage: 'decision' }).success).toBe(true);
  });

  it('rejects invalid buyingStage', () => {
    expect(audiencePersonaSchema.safeParse({ ...validPersona, buyingStage: 'intent' }).success).toBe(false);
  });

  it('rejects missing required name field', () => {
    const { name: _, ...rest } = validPersona;
    expect(audiencePersonaSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-array painPoints', () => {
    expect(audiencePersonaSchema.safeParse({ ...validPersona, painPoints: 'budget issues' }).success).toBe(false);
  });

  it('validates array of personas', () => {
    expect(personasArraySchema.safeParse([validPersona]).success).toBe(true);
    expect(personasArraySchema.safeParse([]).success).toBe(true);
  });
});

describe('contentPricingSchema', () => {
  const validPricing = {
    briefPrice: 99,
    fullPostPrice: 299,
    currency: 'usd',
  };

  it('accepts valid content pricing', () => {
    expect(contentPricingSchema.safeParse(validPricing).success).toBe(true);
  });

  it('accepts pricing with optional label and description fields', () => {
    expect(contentPricingSchema.safeParse({
      ...validPricing,
      briefLabel: 'Content Brief',
      fullPostLabel: 'Full Article',
      briefDescription: 'Detailed SEO brief',
      fullPostDescription: 'Full 1500-word article',
    }).success).toBe(true);
  });

  it('rejects missing briefPrice', () => {
    const { briefPrice: _, ...rest } = validPricing;
    expect(contentPricingSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-numeric price', () => {
    expect(contentPricingSchema.safeParse({ ...validPricing, briefPrice: '99' }).success).toBe(false);
  });
});

describe('businessProfileSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    expect(businessProfileSchema.safeParse({}).success).toBe(true);
  });

  it('accepts full profile', () => {
    expect(businessProfileSchema.safeParse({
      phone: '555-555-5555',
      email: 'info@example.com',
      address: {
        street: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'US',
      },
    }).success).toBe(true);
  });

  it('accepts partial address', () => {
    expect(businessProfileSchema.safeParse({
      address: { city: 'Austin' },
    }).success).toBe(true);
  });
});

describe('intelligenceProfileSchema', () => {
  it('accepts empty object (all optional)', () => {
    expect(intelligenceProfileSchema.safeParse({}).success).toBe(true);
  });

  it('accepts full profile', () => {
    expect(intelligenceProfileSchema.safeParse({
      industry: 'SaaS',
      goals: ['Increase MRR', 'Reduce churn'],
      targetAudience: 'Mid-market B2B',
    }).success).toBe(true);
  });

  it('rejects non-array goals', () => {
    expect(intelligenceProfileSchema.safeParse({ goals: 'grow' }).success).toBe(false);
  });
});

describe('competitorDomainsSchema', () => {
  it('accepts array of strings', () => {
    expect(competitorDomainsSchema.safeParse(['example.com', 'competitor.io']).success).toBe(true);
  });

  it('accepts empty array', () => {
    expect(competitorDomainsSchema.safeParse([]).success).toBe(true);
  });

  it('rejects array with non-string elements', () => {
    expect(competitorDomainsSchema.safeParse([123, 'competitor.io']).success).toBe(false);
  });

  it('rejects non-array input', () => {
    expect(competitorDomainsSchema.safeParse('competitor.io').success).toBe(false);
  });
});

describe('auditSuppressionSchema', () => {
  const validSuppression = {
    check: 'missing-alt',
    pageSlug: '/about',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts valid suppression', () => {
    expect(auditSuppressionSchema.safeParse(validSuppression).success).toBe(true);
  });

  it('accepts suppression with optional fields', () => {
    expect(auditSuppressionSchema.safeParse({
      ...validSuppression,
      pagePattern: '/blog/*',
      reason: 'Intentionally left without alt text',
    }).success).toBe(true);
  });

  it('rejects missing check', () => {
    const { check: _, ...rest } = validSuppression;
    expect(auditSuppressionSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing createdAt', () => {
    const { createdAt: _, ...rest } = validSuppression;
    expect(auditSuppressionSchema.safeParse(rest).success).toBe(false);
  });

  it('validates array of suppressions', () => {
    expect(auditSuppressionsArraySchema.safeParse([validSuppression]).success).toBe(true);
  });
});

describe('recommendationSchema', () => {
  const validRec = {
    id: 'rec-1',
    workspaceId: 'ws-1',
    priority: 'fix_now',
    type: 'technical',
    title: 'Fix missing meta descriptions',
    description: 'Several pages are missing meta descriptions',
    insight: 'Missing meta descriptions impact CTR',
    impact: 'high',
    effort: 'low',
    impactScore: 85,
    source: 'audit',
    affectedPages: ['/about', '/contact'],
    trafficAtRisk: 500,
    impressionsAtRisk: 10000,
    estimatedGain: '10-15% CTR improvement',
    actionType: 'manual',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as const;

  it('accepts valid recommendation', () => {
    expect(recommendationSchema.safeParse(validRec).success).toBe(true);
  });

  it('rejects invalid priority', () => {
    expect(recommendationSchema.safeParse({ ...validRec, priority: 'urgent' }).success).toBe(false);
  });

  it('rejects invalid type', () => {
    expect(recommendationSchema.safeParse({ ...validRec, type: 'unknown_type' }).success).toBe(false);
  });

  it('rejects invalid impact', () => {
    expect(recommendationSchema.safeParse({ ...validRec, impact: 'critical' }).success).toBe(false);
  });

  it('rejects invalid effort', () => {
    expect(recommendationSchema.safeParse({ ...validRec, effort: 'extreme' }).success).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(recommendationSchema.safeParse({ ...validRec, status: 'archived' }).success).toBe(false);
  });

  it('rejects invalid actionType', () => {
    expect(recommendationSchema.safeParse({ ...validRec, actionType: 'unknown' }).success).toBe(false);
  });

  it('accepts all valid priority values', () => {
    for (const priority of ['fix_now', 'fix_soon', 'fix_later', 'ongoing'] as const) {
      expect(recommendationSchema.safeParse({ ...validRec, priority }).success).toBe(true);
    }
  });

  it('accepts all valid type values', () => {
    const types = ['technical', 'content', 'content_refresh', 'schema', 'metadata',
      'performance', 'accessibility', 'strategy', 'aeo'] as const;
    for (const type of types) {
      expect(recommendationSchema.safeParse({ ...validRec, type }).success).toBe(true);
    }
  });
});

// ── server/schemas/diagnostics-schemas.ts ────────────────────────────────────
import {
  rootCauseSchema,
  remediationActionSchema,
} from '../../server/schemas/diagnostics-schemas.js';

describe('rootCauseSchema', () => {
  const validRootCause = {
    rank: 1,
    title: 'Missing meta descriptions',
    confidence: 'high' as const,
    explanation: 'Meta descriptions are missing on 12 pages',
    evidence: ['Page /about has no meta description', 'Page /contact has no meta description'],
  };

  it('accepts valid root cause', () => {
    expect(rootCauseSchema.safeParse(validRootCause).success).toBe(true);
  });

  it('accepts all confidence values', () => {
    for (const confidence of ['high', 'medium', 'low'] as const) {
      expect(rootCauseSchema.safeParse({ ...validRootCause, confidence }).success).toBe(true);
    }
  });

  it('rejects invalid confidence value', () => {
    expect(rootCauseSchema.safeParse({ ...validRootCause, confidence: 'critical' }).success).toBe(false);
  });

  it('rejects rank below 1 (int minimum)', () => {
    expect(rootCauseSchema.safeParse({ ...validRootCause, rank: 0 }).success).toBe(false);
  });

  it('rejects non-integer rank', () => {
    expect(rootCauseSchema.safeParse({ ...validRootCause, rank: 1.5 }).success).toBe(false);
  });

  it('rejects missing title', () => {
    const { title: _, ...rest } = validRootCause;
    expect(rootCauseSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing evidence', () => {
    const { evidence: _, ...rest } = validRootCause;
    expect(rootCauseSchema.safeParse(rest).success).toBe(false);
  });
});

describe('remediationActionSchema', () => {
  const validAction = {
    priority: 'P1' as const,
    title: 'Add meta descriptions',
    description: 'Write unique meta descriptions for all pages',
    effort: 'low' as const,
    impact: 'high' as const,
    owner: 'content' as const,
  };

  it('accepts valid remediation action', () => {
    expect(remediationActionSchema.safeParse(validAction).success).toBe(true);
  });

  it('accepts all priority values', () => {
    for (const priority of ['P0', 'P1', 'P2', 'P3'] as const) {
      expect(remediationActionSchema.safeParse({ ...validAction, priority }).success).toBe(true);
    }
  });

  it('rejects invalid priority', () => {
    expect(remediationActionSchema.safeParse({ ...validAction, priority: 'P4' }).success).toBe(false);
  });

  it('accepts all owner values', () => {
    for (const owner of ['dev', 'content', 'seo'] as const) {
      expect(remediationActionSchema.safeParse({ ...validAction, owner }).success).toBe(true);
    }
  });

  it('rejects invalid owner', () => {
    expect(remediationActionSchema.safeParse({ ...validAction, owner: 'design' }).success).toBe(false);
  });

  it('accepts optional pageUrls', () => {
    expect(remediationActionSchema.safeParse({ ...validAction, pageUrls: ['/about', '/contact'] }).success).toBe(true);
  });

  it('rejects non-array pageUrls', () => {
    expect(remediationActionSchema.safeParse({ ...validAction, pageUrls: '/about' }).success).toBe(false);
  });
});

// ── server/schemas/keyword-feedback.ts ───────────────────────────────────────
import {
  keywordFeedbackSchema,
  keywordFeedbackSourceSchema,
  bulkKeywordFeedbackSchema,
  contentGapVoteSchema,
  adminKeywordFeedbackSchema,
} from '../../server/schemas/keyword-feedback.js';

describe('keywordFeedbackSourceSchema', () => {
  it('accepts all valid source values', () => {
    for (const source of ['content_gap', 'page_map', 'opportunity', 'topic_cluster', 'keyword_gap'] as const) {
      expect(keywordFeedbackSourceSchema.safeParse(source).success).toBe(true);
    }
  });

  it('rejects invalid source', () => {
    expect(keywordFeedbackSourceSchema.safeParse('manual').success).toBe(false);
    expect(keywordFeedbackSourceSchema.safeParse('').success).toBe(false);
  });
});

describe('keywordFeedbackSchema', () => {
  const validFeedback = {
    keyword: 'seo agency',
    status: 'approved' as const,
  };

  it('accepts valid feedback with required fields only', () => {
    expect(keywordFeedbackSchema.safeParse(validFeedback).success).toBe(true);
  });

  it('accepts all valid status values', () => {
    for (const status of ['approved', 'declined', 'requested'] as const) {
      expect(keywordFeedbackSchema.safeParse({ ...validFeedback, status }).success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    expect(keywordFeedbackSchema.safeParse({ ...validFeedback, status: 'pending' }).success).toBe(false);
  });

  it('rejects empty keyword', () => {
    expect(keywordFeedbackSchema.safeParse({ ...validFeedback, keyword: '' }).success).toBe(false);
  });

  it('accepts optional reason as empty string (clearable pattern)', () => {
    expect(keywordFeedbackSchema.safeParse({ ...validFeedback, reason: '' }).success).toBe(true);
  });

  it('accepts optional source defaulting to content_gap', () => {
    const result = keywordFeedbackSchema.safeParse(validFeedback);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('content_gap');
    }
  });

  it('rejects extra fields not in schema (strict)', () => {
    expect(keywordFeedbackSchema.safeParse({ ...validFeedback, unknownField: 'x' }).success).toBe(false);
  });
});

describe('bulkKeywordFeedbackSchema', () => {
  const validBulk = {
    keywords: [{ keyword: 'seo agency', status: 'approved' }],
  };

  it('accepts valid bulk feedback', () => {
    expect(bulkKeywordFeedbackSchema.safeParse(validBulk).success).toBe(true);
  });

  it('rejects empty keywords array', () => {
    expect(bulkKeywordFeedbackSchema.safeParse({ keywords: [] }).success).toBe(false);
  });
});

describe('contentGapVoteSchema', () => {
  it('accepts all valid vote values', () => {
    for (const vote of ['up', 'down', 'none'] as const) {
      expect(contentGapVoteSchema.safeParse({ keyword: 'seo agency', vote }).success).toBe(true);
    }
  });

  it('rejects invalid vote', () => {
    expect(contentGapVoteSchema.safeParse({ keyword: 'seo agency', vote: 'neutral' }).success).toBe(false);
  });

  it('rejects empty keyword', () => {
    expect(contentGapVoteSchema.safeParse({ keyword: '', vote: 'up' }).success).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    expect(contentGapVoteSchema.safeParse({ keyword: 'seo', vote: 'up', extra: 'x' }).success).toBe(false);
  });
});

describe('adminKeywordFeedbackSchema', () => {
  it('accepts feedback with optional declinedBy', () => {
    expect(adminKeywordFeedbackSchema.safeParse({
      keyword: 'seo agency',
      status: 'declined',
      declinedBy: 'admin@example.com',
    }).success).toBe(true);
  });

  it('accepts empty string for declinedBy (clearable pattern)', () => {
    expect(adminKeywordFeedbackSchema.safeParse({
      keyword: 'seo agency',
      status: 'declined',
      declinedBy: '',
    }).success).toBe(true);
  });
});

// ── server/schemas/voice-calibration.ts ──────────────────────────────────────
import {
  saveVariationFeedbackSchema,
  variationFeedbackItemSchema,
} from '../../server/schemas/voice-calibration.js';

describe('saveVariationFeedbackSchema', () => {
  const validFeedback = {
    sessionId: 'cal_a1b2c3d4',
    variationIndex: 0,
    feedback: 'This variation feels more natural',
  };

  it('accepts valid variation feedback', () => {
    expect(saveVariationFeedbackSchema.safeParse(validFeedback).success).toBe(true);
  });

  it('rejects empty sessionId', () => {
    expect(saveVariationFeedbackSchema.safeParse({ ...validFeedback, sessionId: '' }).success).toBe(false);
  });

  it('rejects negative variationIndex', () => {
    expect(saveVariationFeedbackSchema.safeParse({ ...validFeedback, variationIndex: -1 }).success).toBe(false);
  });

  it('rejects variationIndex above 100', () => {
    expect(saveVariationFeedbackSchema.safeParse({ ...validFeedback, variationIndex: 101 }).success).toBe(false);
  });

  it('accepts variationIndex boundary value of 100', () => {
    expect(saveVariationFeedbackSchema.safeParse({ ...validFeedback, variationIndex: 100 }).success).toBe(true);
  });

  it('accepts variationIndex boundary value of 0', () => {
    expect(saveVariationFeedbackSchema.safeParse({ ...validFeedback, variationIndex: 0 }).success).toBe(true);
  });

  it('rejects empty feedback string', () => {
    expect(saveVariationFeedbackSchema.safeParse({ ...validFeedback, feedback: '' }).success).toBe(false);
  });

  it('rejects feedback exceeding 2000 characters', () => {
    expect(saveVariationFeedbackSchema.safeParse({
      ...validFeedback,
      feedback: 'x'.repeat(2001),
    }).success).toBe(false);
  });

  it('accepts feedback at exactly 2000 characters', () => {
    expect(saveVariationFeedbackSchema.safeParse({
      ...validFeedback,
      feedback: 'x'.repeat(2000),
    }).success).toBe(true);
  });
});

describe('variationFeedbackItemSchema', () => {
  const validItem = {
    variationIndex: 1,
    feedback: 'Great tone',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts valid feedback item', () => {
    expect(variationFeedbackItemSchema.safeParse(validItem).success).toBe(true);
  });

  it('rejects variationIndex below 0', () => {
    expect(variationFeedbackItemSchema.safeParse({ ...validItem, variationIndex: -1 }).success).toBe(false);
  });

  it('rejects missing createdAt', () => {
    const { createdAt: _, ...rest } = validItem;
    expect(variationFeedbackItemSchema.safeParse(rest).success).toBe(false);
  });
});

// ── server/schemas/content-schemas.ts — additional coverage ──────────────────
import {
  serpAnalysisSchema,
  eeatGuidanceSchema,
  keywordValidationSchema,
  realTopResultSchema,
  reviewChecklistSchema,
} from '../../server/schemas/content-schemas.js';

describe('serpAnalysisSchema', () => {
  const validSerp = {
    contentType: 'listicle',
    avgWordCount: 1800,
    commonElements: ['FAQ section', 'Table of contents'],
    gaps: ['No video content', 'Missing schema markup'],
  };

  it('accepts valid SERP analysis', () => {
    expect(serpAnalysisSchema.safeParse(validSerp).success).toBe(true);
  });

  it('rejects missing avgWordCount', () => {
    const { avgWordCount: _, ...rest } = validSerp;
    expect(serpAnalysisSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-array commonElements', () => {
    expect(serpAnalysisSchema.safeParse({ ...validSerp, commonElements: 'FAQ section' }).success).toBe(false);
  });
});

describe('eeatGuidanceSchema', () => {
  const validEeat = {
    experience: 'Include first-hand case studies',
    expertise: 'Cite technical sources',
    authority: 'Link to industry publications',
    trust: 'Include author bio and credentials',
  };

  it('accepts valid EEAT guidance', () => {
    expect(eeatGuidanceSchema.safeParse(validEeat).success).toBe(true);
  });

  it('rejects missing experience field', () => {
    const { experience: _, ...rest } = validEeat;
    expect(eeatGuidanceSchema.safeParse(rest).success).toBe(false);
  });
});

describe('keywordValidationSchema', () => {
  const validKw = {
    volume: 5400,
    difficulty: 42,
    cpc: 3.75,
    validatedAt: '2026-01-15T00:00:00.000Z',
  };

  it('accepts valid keyword validation data', () => {
    expect(keywordValidationSchema.safeParse(validKw).success).toBe(true);
  });

  it('rejects non-numeric volume', () => {
    expect(keywordValidationSchema.safeParse({ ...validKw, volume: '5400' }).success).toBe(false);
  });

  it('rejects missing validatedAt', () => {
    const { validatedAt: _, ...rest } = validKw;
    expect(keywordValidationSchema.safeParse(rest).success).toBe(false);
  });
});

describe('realTopResultSchema', () => {
  const validResult = {
    position: 1,
    title: 'Best SEO Agencies in 2026',
    url: 'https://example.com/seo-agencies',
  };

  it('accepts valid top result', () => {
    expect(realTopResultSchema.safeParse(validResult).success).toBe(true);
  });

  it('rejects non-numeric position', () => {
    expect(realTopResultSchema.safeParse({ ...validResult, position: '1st' }).success).toBe(false);
  });
});

describe('reviewChecklistSchema', () => {
  const validChecklist = {
    factual_accuracy: true,
    brand_voice: true,
    internal_links: false,
    no_hallucinations: true,
    meta_optimized: false,
    word_count_target: true,
  };

  it('accepts valid review checklist', () => {
    expect(reviewChecklistSchema.safeParse(validChecklist).success).toBe(true);
  });

  it('rejects non-boolean checklist values', () => {
    expect(reviewChecklistSchema.safeParse({ ...validChecklist, factual_accuracy: 1 }).success).toBe(false);
  });

  it('rejects missing required checklist field', () => {
    const { factual_accuracy: _, ...rest } = validChecklist;
    expect(reviewChecklistSchema.safeParse(rest).success).toBe(false);
  });
});
