/**
 * Unit tests for Plan B AI schema files.
 *
 * Tests that:
 * - Valid fixtures parse successfully
 * - Invalid/missing fields produce parse errors
 * - The AI operation registry has the 4 new operations
 */
import { describe, it, expect } from 'vitest';
import {
  parseContentBriefOutline,
  parseContentBriefSchema,
  aiContentBriefOutlineSchema,
} from '../../server/schemas/ai-content-brief.js';
import {
  parseAeoReview,
  aiAeoReviewSchema,
} from '../../server/schemas/ai-aeo-review.js';
import {
  parseDiagnosticRootCauses,
  aiRootCauseAnalysisSchema,
} from '../../server/schemas/ai-diagnostic.js';
import {
  parseSchemaPlan,
  aiSchemaPlanSchema,
} from '../../server/schemas/ai-schema-plan.js';
import { AI_OPERATION_REGISTRY } from '../../server/ai-operation-registry.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

const VALID_OUTLINE = JSON.stringify([
  { heading: 'Introduction', notes: 'Set context', wordCount: 200, keywords: ['seo', 'content'] },
  { heading: 'Main Topic', notes: 'Deep dive', subheadings: ['Sub A', 'Sub B'], wordCount: 400, keywords: ['strategy'] },
]);

const INVALID_OUTLINE_OBJECT = JSON.stringify({ outline: [{ heading: 'H2', notes: 'notes' }] });
const INVALID_OUTLINE_MISSING_HEADING = JSON.stringify([{ notes: 'no heading field' }]);

const VALID_BRIEF = JSON.stringify({
  suggestedTitle: 'Test Title',
  suggestedMetaDesc: 'Test meta',
  outline: [{ heading: 'Intro', notes: 'notes', wordCount: 200, keywords: [] }],
  secondaryKeywords: ['keyword1'],
  intent: 'informational',
  audience: 'Developers',
});

const VALID_AEO_REVIEW = JSON.stringify({
  overallScore: 72,
  summary: 'The page has good structure but needs citation improvements.',
  changes: [
    {
      changeType: 'add_citations',
      location: 'Introduction section',
      suggestedChange: 'Add a citation for the statistic.',
      rationale: 'Improves trust signals.',
      effort: 'quick',
      priority: 'high',
      aeoImpact: 'Increases citation likelihood by AI systems.',
    },
  ],
  quickWinCount: 1,
  estimatedTimeMinutes: 30,
});

const VALID_DIAGNOSTICS = JSON.stringify({
  rootCauses: [
    {
      rank: 1,
      title: 'Traffic Drop',
      confidence: 'high',
      explanation: 'GSC data shows 40% drop in impressions.',
      evidence: ['GSC impressions: 4k → 2.4k', 'Audit score stable'],
    },
  ],
  remediationActions: [
    {
      priority: 'P1',
      title: 'Fix redirect chain',
      description: 'Homepage has 3-hop redirect chain.',
      effort: 'low',
      impact: 'high',
      owner: 'dev',
    },
  ],
  adminReport: '## Summary\n\nDrop detected.',
  clientSummary: 'We identified a technical issue causing lower visibility.',
});

const VALID_SCHEMA_PLAN = JSON.stringify({
  canonicalEntities: [
    { type: 'SoftwareApplication', name: 'MyApp', canonicalUrl: 'https://example.com/app', id: 'https://example.com/app/#software' },
  ],
  pageRoles: [
    { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: ['https://example.com/app/#software'] },
    { pagePath: '/features', pageTitle: 'Features', role: 'pillar', primaryType: 'SoftwareApplication', entityRefs: [], notes: 'Main product page', industrySubtype: null },
  ],
});

// ── aiContentBriefOutlineSchema ────────────────────────────────────────────

describe('parseContentBriefOutline', () => {
  it('parses a valid outline array', () => {
    const result = parseContentBriefOutline(VALID_OUTLINE);
    expect(result).toHaveLength(2);
    expect(result[0].heading).toBe('Introduction');
    expect(result[1].subheadings).toEqual(['Sub A', 'Sub B']);
  });

  it('throws when the model returns an object with an outline key (fallback removal regression)', () => {
    // This test locks the removal of the outlineParsed.outline ?? outlineParsed.sections fallback.
    // The model must return a bare array; if it returns {outline:[...]}, it's a prompt drift.
    expect(() => parseContentBriefOutline(INVALID_OUTLINE_OBJECT)).toThrow();
  });

  it('throws when a section is missing the required heading field', () => {
    expect(() => parseContentBriefOutline(INVALID_OUTLINE_MISSING_HEADING)).toThrow();
  });

  it('throws when the model returns an object with a sections alias', () => {
    const sectionsAlias = JSON.stringify({ sections: [{ heading: 'H', notes: 'n' }] });
    expect(() => parseContentBriefOutline(sectionsAlias)).toThrow();
  });

  it('throws on invalid JSON', () => {
    expect(() => parseContentBriefOutline('not json')).toThrow();
  });
});

describe('parseContentBriefSchema', () => {
  it('parses a valid full brief response', () => {
    const result = parseContentBriefSchema(VALID_BRIEF);
    expect(result.suggestedTitle).toBe('Test Title');
    expect(result.outline).toHaveLength(1);
    expect(result.secondaryKeywords).toEqual(['keyword1']);
  });

  it('returns object with undefined optional fields when not present', () => {
    const minimal = JSON.stringify({ suggestedTitle: 'Minimal' });
    const result = parseContentBriefSchema(minimal);
    expect(result.suggestedTitle).toBe('Minimal');
    expect(result.outline).toBeUndefined();
  });

  it('throws on invalid JSON', () => {
    expect(() => parseContentBriefSchema('{')).toThrow();
  });
});

// ── aiAeoReviewSchema ──────────────────────────────────────────────────────

describe('parseAeoReview', () => {
  it('parses a valid AEO review response', () => {
    const result = parseAeoReview(VALID_AEO_REVIEW);
    expect(result.overallScore).toBe(72);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].effort).toBe('quick');
    expect(result.quickWinCount).toBe(1);
  });

  it('applies .catch fallbacks for missing required fields', () => {
    const minimal = JSON.stringify({});
    const result = parseAeoReview(minimal);
    expect(result.overallScore).toBe(0);
    expect(result.summary).toBe('AEO review completed.');
    expect(result.changes).toEqual([]);
  });

  it('normalizes unknown effort values', () => {
    const withUnknownEffort = JSON.stringify({
      overallScore: 50,
      summary: 'ok',
      changes: [{ changeType: 'copy_edit', location: 'here', suggestedChange: 'fix', rationale: 'reason', effort: 'low', priority: 'medium', aeoImpact: 'helps' }],
    });
    const result = parseAeoReview(withUnknownEffort);
    expect(result.changes[0].effort).toBe('quick');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAeoReview('bad')).toThrow();
  });
});

// ── aiRootCauseAnalysisSchema ──────────────────────────────────────────────

describe('parseDiagnosticRootCauses', () => {
  it('parses a valid diagnostics response', () => {
    const result = parseDiagnosticRootCauses(VALID_DIAGNOSTICS);
    expect(result.rootCauses).toHaveLength(1);
    expect(result.rootCauses[0].confidence).toBe('high');
    expect(result.remediationActions).toHaveLength(1);
    expect(result.adminReport).toContain('Drop detected');
  });

  it('defaults empty arrays and strings when fields are missing', () => {
    const empty = JSON.stringify({});
    const result = parseDiagnosticRootCauses(empty);
    expect(result.rootCauses).toEqual([]);
    expect(result.remediationActions).toEqual([]);
    expect(result.adminReport).toBe('');
    expect(result.clientSummary).toBe('');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseDiagnosticRootCauses('nope')).toThrow();
  });
});

// ── aiSchemaPlanSchema ─────────────────────────────────────────────────────

describe('parseSchemaPlan', () => {
  it('parses a valid schema plan response', () => {
    const result = parseSchemaPlan(VALID_SCHEMA_PLAN);
    expect(result.canonicalEntities).toHaveLength(1);
    expect(result.pageRoles).toHaveLength(2);
    expect(result.pageRoles[0].role).toBe('homepage');
    expect(result.pageRoles[1].role).toBe('pillar');
  });

  it('normalizes unknown role values to generic', () => {
    const withUnknownRole = JSON.stringify({
      canonicalEntities: [],
      pageRoles: [{ pagePath: '/unknown', role: 'not-a-real-role', pageTitle: 'Unknown' }],
    });
    const result = parseSchemaPlan(withUnknownRole);
    expect(result.pageRoles[0].role).toBe('generic');
  });

  it('throws when canonicalEntities or pageRoles are missing', () => {
    expect(() => parseSchemaPlan(JSON.stringify({ canonicalEntities: [] }))).toThrow();
    expect(() => parseSchemaPlan(JSON.stringify({ pageRoles: [] }))).toThrow();
  });

  it('throws on invalid JSON', () => {
    expect(() => parseSchemaPlan('{')).toThrow();
  });
});

// ── AI operation registry ──────────────────────────────────────────────────

describe('AI_OPERATION_REGISTRY', () => {
  it('contains content-brief-outline operation', () => {
    expect(AI_OPERATION_REGISTRY['content-brief-outline']).toBeDefined();
    expect(AI_OPERATION_REGISTRY['content-brief-outline'].outputMode).toBe('json');
    expect(AI_OPERATION_REGISTRY['content-brief-outline'].domain).toBe('content-pipeline');
  });

  it('contains aeo-page-review operation', () => {
    expect(AI_OPERATION_REGISTRY['aeo-page-review']).toBeDefined();
    expect(AI_OPERATION_REGISTRY['aeo-page-review'].outputMode).toBe('json');
  });

  it('contains diagnostic-root-causes operation', () => {
    expect(AI_OPERATION_REGISTRY['diagnostic-root-causes']).toBeDefined();
    expect(AI_OPERATION_REGISTRY['diagnostic-root-causes'].domain).toBe('analytics-intelligence');
  });

  it('contains schema-plan-generate operation', () => {
    expect(AI_OPERATION_REGISTRY['schema-plan-generate']).toBeDefined();
    expect(AI_OPERATION_REGISTRY['schema-plan-generate'].domain).toBe('schema');
  });
});
