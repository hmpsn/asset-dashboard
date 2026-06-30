/**
 * Pure-logic unit tests for server/blueprint-generator.ts
 *
 * Tests focus on:
 *  - getDefaultSectionPlan: template selection, UUID assignment,
 *    order normalisation, fallback to 'service' for unknown page types
 *  - DEFAULT_SECTION_PLANS shape validation per page type
 *  - Entry scope normalisation logic (included / recommended / fallback)
 *  - isCollection coercion
 */

import { describe, it, expect, vi } from 'vitest';

// ── Module-level mocks (hoisted before imports) ────────────────────────────

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));
vi.mock('../../server/ai.js', () => ({ callAI: vi.fn() }));
vi.mock('../../server/helpers.js', () => ({ stripCodeFences: vi.fn((s: string) => s) }));
vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: vi.fn((raw: unknown, fallback: unknown) => {
    try {
      return JSON.parse(String(raw));
    } catch {
      return fallback;
    }
  }),
}));
vi.mock('../../server/brandscript.js', () => ({ getBrandscript: vi.fn(() => null) }));
vi.mock('../../server/local-seo.js', () => ({ resolveWorkspaceLocationCode: vi.fn(() => null) }));
vi.mock('../../server/seo-data-provider.js', () => ({ getConfiguredProvider: vi.fn(() => null) }));
vi.mock('../../server/workspaces.js', () => ({ getWorkspace: vi.fn(() => null) }));
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => ({})),
  formatForPrompt: vi.fn(() => ''),
}));
vi.mock('../../server/page-strategy.js', () => ({
  createBlueprint: vi.fn(),
  deleteBlueprint: vi.fn(),
  bulkAddEntries: vi.fn(() => []),
  updateBlueprint: vi.fn(),
  updateEntry: vi.fn(),
  getBlueprint: vi.fn(() => null),
}));
vi.mock('../../server/content-brief.js', () => ({ generateBrief: vi.fn(async () => ({ id: 'brief_1' })) }));

import { getDefaultSectionPlan, parseBlueprintGenerationOutput } from '../../server/blueprint-generator.js';
import { getPageTypeOutlineContract } from '../../server/page-type-copy-contract.js';

function totalTargetWords(pageType: string): number {
  return getDefaultSectionPlan(pageType).reduce((sum, item) => sum + item.wordCountTarget, 0);
}

describe('parseBlueprintGenerationOutput', () => {
  it('accepts valid blueprint JSON before database writes', () => {
    const entries = parseBlueprintGenerationOutput(JSON.stringify([
      {
        name: 'Emergency Plumbing',
        pageType: 'service',
        scope: 'included',
        isCollection: false,
        primaryKeyword: 'emergency plumber austin',
        secondaryKeywords: ['24 hour plumber'],
        rationale: 'Core revenue page.',
      },
    ]));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: 'Emergency Plumbing',
      pageType: 'service',
      scope: 'included',
    });
  });

  it('fails closed for malformed parseable blueprint JSON', () => {
    expect(() => parseBlueprintGenerationOutput(JSON.stringify([
      {
        name: 'Broken Page',
        pageType: 'not-a-page-type',
        scope: 'included',
        isCollection: false,
      },
    ]))).toThrow('schema validation');
  });
});

// ── getDefaultSectionPlan ─────────────────────────────────────────────────

describe('getDefaultSectionPlan — homepage', () => {
  it('returns an array of section plan items', () => {
    const plan = getDefaultSectionPlan('homepage');
    expect(Array.isArray(plan)).toBe(true);
    expect(plan.length).toBeGreaterThan(0);
  });

  it('every item has a non-empty string id (UUID)', () => {
    const plan = getDefaultSectionPlan('homepage');
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const item of plan) {
      expect(item.id).toMatch(UUID_RE);
    }
  });

  it('ids are unique within the plan', () => {
    const plan = getDefaultSectionPlan('homepage');
    const ids = plan.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('items are ordered 0, 1, 2, ... (normalised at runtime)', () => {
    const plan = getDefaultSectionPlan('homepage');
    plan.forEach((item, i) => {
      expect(item.order).toBe(i);
    });
  });

  it('every item has a positive wordCountTarget', () => {
    const plan = getDefaultSectionPlan('homepage');
    for (const item of plan) {
      expect(item.wordCountTarget).toBeGreaterThan(0);
    }
  });

  it('first section is a hero', () => {
    const plan = getDefaultSectionPlan('homepage');
    expect(plan[0].sectionType).toBe('hero');
  });

  it('includes a cta section', () => {
    const plan = getDefaultSectionPlan('homepage');
    expect(plan.some(s => s.sectionType === 'cta')).toBe(true);
  });
});

describe('getDefaultSectionPlan — landing page', () => {
  it('has an explicit compact conversion plan instead of falling back to service', () => {
    const plan = getDefaultSectionPlan('landing');
    const servicePlan = getDefaultSectionPlan('service');
    expect(plan.map(s => s.sectionType)).toEqual(['hero', 'problem', 'solution', 'social-proof', 'cta']);
    expect(plan.map(s => s.sectionType)).not.toEqual(servicePlan.map(s => s.sectionType));
  });
});

describe('getDefaultSectionPlan — service page', () => {
  it('stays within the service page density contract', () => {
    const contract = getPageTypeOutlineContract('service')!;
    const servicePlan = getDefaultSectionPlan('service');
    const targetWords = totalTargetWords('service');
    expect(servicePlan.length).toBeGreaterThanOrEqual(contract.minSections);
    expect(servicePlan.length).toBeLessThanOrEqual(contract.maxSections);
    expect(targetWords).toBeGreaterThanOrEqual(contract.minWords);
    expect(targetWords).toBeLessThanOrEqual(contract.maxWords);
  });

  it('includes faq section (objection-handling)', () => {
    const plan = getDefaultSectionPlan('service');
    expect(plan.some(s => s.sectionType === 'faq')).toBe(true);
  });

  it('contains a features-benefits section', () => {
    const plan = getDefaultSectionPlan('service');
    expect(plan.some(s => s.sectionType === 'features-benefits')).toBe(true);
  });
});

describe('getDefaultSectionPlan — about page', () => {
  it('includes about-team section', () => {
    const plan = getDefaultSectionPlan('about');
    expect(plan.some(s => s.sectionType === 'about-team')).toBe(true);
  });

  it('has social-proof for trust signals', () => {
    const plan = getDefaultSectionPlan('about');
    expect(plan.some(s => s.sectionType === 'social-proof')).toBe(true);
  });
});

describe('getDefaultSectionPlan — contact page', () => {
  it('includes contact-form section', () => {
    const plan = getDefaultSectionPlan('contact');
    expect(plan.some(s => s.sectionType === 'contact-form')).toBe(true);
  });

  it('includes location-info section', () => {
    const plan = getDefaultSectionPlan('contact');
    expect(plan.some(s => s.sectionType === 'location-info')).toBe(true);
  });

  it('does not seed contact copy with SEO operations guidance', () => {
    const plan = getDefaultSectionPlan('contact');
    const notes = plan.flatMap(s => [s.brandNote, s.seoNote]).filter(Boolean).join('\n');
    expect(notes).not.toMatch(/\bNAP\b|schema|Google Business Profile|director(?:y|ies)|structured data/i);
  });
});

describe('getDefaultSectionPlan — location page', () => {
  it('starts with a hero', () => {
    const plan = getDefaultSectionPlan('location');
    expect(plan[0].sectionType).toBe('hero');
  });

  it('stays within the location page density contract', () => {
    const contract = getPageTypeOutlineContract('location')!;
    const plan = getDefaultSectionPlan('location');
    const targetWords = totalTargetWords('location');
    expect(plan.length).toBeGreaterThanOrEqual(contract.minSections);
    expect(plan.length).toBeLessThanOrEqual(contract.maxSections);
    expect(targetWords).toBeGreaterThanOrEqual(contract.minWords);
    expect(targetWords).toBeLessThanOrEqual(contract.maxWords);
  });

  it('includes location-info without public-facing local SEO mechanics', () => {
    const plan = getDefaultSectionPlan('location');
    expect(plan.some(s => s.sectionType === 'location-info')).toBe(true);
    const notes = plan.flatMap(s => [s.brandNote, s.seoNote]).filter(Boolean).join('\n');
    expect(notes).not.toMatch(/\bNAP\b|schema|Google Business Profile|director(?:y|ies)|structured data/i);
  });
});

describe('getDefaultSectionPlan — conversion page density', () => {
  it.each(['landing', 'service', 'location'] as const)('%s plan matches its outline contract bounds', (pageType) => {
    const contract = getPageTypeOutlineContract(pageType)!;
    const plan = getDefaultSectionPlan(pageType);
    const targetWords = totalTargetWords(pageType);
    expect(plan.length).toBeGreaterThanOrEqual(contract.minSections);
    expect(plan.length).toBeLessThanOrEqual(contract.maxSections);
    expect(targetWords).toBeGreaterThanOrEqual(contract.minWords);
    expect(targetWords).toBeLessThanOrEqual(contract.maxWords);
  });
});

describe('getDefaultSectionPlan — blog page', () => {
  it('includes content-body section with high word count target', () => {
    const plan = getDefaultSectionPlan('blog');
    const contentBody = plan.find(s => s.sectionType === 'content-body');
    expect(contentBody).toBeDefined();
    expect(contentBody!.wordCountTarget).toBeGreaterThanOrEqual(1000);
  });

  it('includes related-resources section', () => {
    const plan = getDefaultSectionPlan('blog');
    expect(plan.some(s => s.sectionType === 'related-resources')).toBe(true);
  });
});

describe('getDefaultSectionPlan — unknown page type fallback', () => {
  it('falls back to service plan for an unrecognised page type', () => {
    const fallback = getDefaultSectionPlan('does-not-exist');
    const service = getDefaultSectionPlan('service');
    // Same number of sections and same types (ids will differ)
    expect(fallback.length).toBe(service.length);
    fallback.forEach((item, i) => {
      expect(item.sectionType).toBe(service[i].sectionType);
    });
  });

  it('assigns unique UUIDs even for fallback plan', () => {
    const plan = getDefaultSectionPlan('totally-unknown-type');
    const ids = plan.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getDefaultSectionPlan — two calls produce independent UUID sets', () => {
  it('different invocations produce different UUIDs', () => {
    const plan1 = getDefaultSectionPlan('homepage');
    const plan2 = getDefaultSectionPlan('homepage');
    const ids1 = plan1.map(i => i.id);
    const ids2 = plan2.map(i => i.id);
    // No UUID from plan1 should appear in plan2
    const overlap = ids1.filter(id => ids2.includes(id));
    expect(overlap.length).toBe(0);
  });

  it('original template is not mutated between calls', () => {
    const plan1 = getDefaultSectionPlan('homepage');
    const plan2 = getDefaultSectionPlan('homepage');
    // Structure should be identical except for IDs
    plan1.forEach((item, i) => {
      expect(item.sectionType).toBe(plan2[i].sectionType);
      expect(item.narrativeRole).toBe(plan2[i].narrativeRole);
      expect(item.wordCountTarget).toBe(plan2[i].wordCountTarget);
    });
  });
});

describe('getDefaultSectionPlan — all known page types', () => {
  const knownTypes = ['homepage', 'service', 'about', 'location', 'contact', 'faq', 'testimonials', 'blog'];

  for (const pageType of knownTypes) {
    it(`returns a non-empty plan for "${pageType}"`, () => {
      const plan = getDefaultSectionPlan(pageType);
      expect(plan.length).toBeGreaterThan(0);
    });
  }
});
