/**
 * Unit tests for server/content-brief.ts — brief CRUD operations.
 *
 * Note: generateBrief() requires OPENAI_API_KEY and is not tested here.
 * This file tests the synchronous CRUD operations.
 */
import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import {
  listBriefs,
  getBrief,
  updateBrief,
  deleteBrief,
  buildStrategyCardBlock,
  getPageTypeConfig,
  type ContentBrief,
} from '../../server/content-brief.js';
import type { StrategyCardContext } from '../../shared/types/content.js';

// Helper to create a brief directly via SQLite (since createBrief requires OpenAI)
function seedBrief(workspaceId: string, brief: ContentBrief): void {
  db.prepare(
    `INSERT OR IGNORE INTO content_briefs
       (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
        suggested_meta_desc, outline, word_count_target, intent, audience,
        competitor_insights, internal_link_suggestions, created_at,
        executive_summary, content_format, tone_and_style, people_also_ask,
        topical_entities, serp_analysis, difficulty_score, traffic_potential,
        cta_recommendations, eeat_guidance, content_checklist, schema_recommendations,
        page_type, reference_urls, real_people_also_ask, real_top_results)
     VALUES
       (@id, @workspace_id, @target_keyword, @secondary_keywords, @suggested_title,
        @suggested_meta_desc, @outline, @word_count_target, @intent, @audience,
        @competitor_insights, @internal_link_suggestions, @created_at,
        @executive_summary, @content_format, @tone_and_style, @people_also_ask,
        @topical_entities, @serp_analysis, @difficulty_score, @traffic_potential,
        @cta_recommendations, @eeat_guidance, @content_checklist, @schema_recommendations,
        @page_type, @reference_urls, @real_people_also_ask, @real_top_results)`,
  ).run({
    id: brief.id,
    workspace_id: workspaceId,
    target_keyword: brief.targetKeyword,
    secondary_keywords: JSON.stringify(brief.secondaryKeywords),
    suggested_title: brief.suggestedTitle,
    suggested_meta_desc: brief.suggestedMetaDesc,
    outline: JSON.stringify(brief.outline),
    word_count_target: brief.wordCountTarget,
    intent: brief.intent,
    audience: brief.audience,
    competitor_insights: brief.competitorInsights,
    internal_link_suggestions: JSON.stringify(brief.internalLinkSuggestions),
    created_at: brief.createdAt,
    executive_summary: brief.executiveSummary ?? null,
    content_format: brief.contentFormat ?? null,
    tone_and_style: brief.toneAndStyle ?? null,
    people_also_ask: brief.peopleAlsoAsk ? JSON.stringify(brief.peopleAlsoAsk) : null,
    topical_entities: brief.topicalEntities ? JSON.stringify(brief.topicalEntities) : null,
    serp_analysis: brief.serpAnalysis ? JSON.stringify(brief.serpAnalysis) : null,
    difficulty_score: brief.difficultyScore ?? null,
    traffic_potential: brief.trafficPotential ?? null,
    cta_recommendations: brief.ctaRecommendations ? JSON.stringify(brief.ctaRecommendations) : null,
    eeat_guidance: brief.eeatGuidance ? JSON.stringify(brief.eeatGuidance) : null,
    content_checklist: brief.contentChecklist ? JSON.stringify(brief.contentChecklist) : null,
    schema_recommendations: brief.schemaRecommendations ? JSON.stringify(brief.schemaRecommendations) : null,
    page_type: brief.pageType ?? null,
    reference_urls: brief.referenceUrls ? JSON.stringify(brief.referenceUrls) : null,
    real_people_also_ask: brief.realPeopleAlsoAsk ? JSON.stringify(brief.realPeopleAlsoAsk) : null,
    real_top_results: brief.realTopResults ? JSON.stringify(brief.realTopResults) : null,
  });
}

function cleanupWorkspace(workspaceId: string): void {
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(workspaceId);
}

function makeBrief(id: string, workspaceId: string, overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    id,
    workspaceId,
    targetKeyword: 'test keyword',
    secondaryKeywords: ['secondary1', 'secondary2'],
    suggestedTitle: 'Test Brief Title',
    suggestedMetaDesc: 'Test meta description',
    outline: [
      { heading: 'Introduction', notes: 'Intro notes', wordCount: 200, keywords: ['test'] },
      { heading: 'Main Section', subheadings: ['Sub 1', 'Sub 2'], notes: 'Main notes', wordCount: 500, keywords: ['test', 'keyword'] },
    ],
    wordCountTarget: 1800,
    intent: 'informational',
    audience: 'general',
    competitorInsights: 'Competitors focus on...',
    internalLinkSuggestions: ['/about', '/services'],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── listBriefs ──

describe('listBriefs', () => {
  const wsId = 'ws_brief_list_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('returns empty array for workspace with no briefs', () => {
    expect(listBriefs('ws_nonexistent_briefs')).toEqual([]);
  });

  it('returns seeded briefs sorted by createdAt (newest first)', () => {
    const older = makeBrief('brief_old', wsId, { createdAt: '2024-01-01T00:00:00Z' });
    const newer = makeBrief('brief_new', wsId, { createdAt: '2024-06-01T00:00:00Z' });
    seedBrief(wsId, older);
    seedBrief(wsId, newer);

    const briefs = listBriefs(wsId);
    expect(briefs).toHaveLength(2);
    expect(briefs[0].id).toBe('brief_new');
    expect(briefs[1].id).toBe('brief_old');
  });
});

// ── getBrief ──

describe('getBrief', () => {
  const wsId = 'ws_brief_get_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('returns a specific brief by id', () => {
    seedBrief(wsId, makeBrief('brief_find', wsId, { targetKeyword: 'findable keyword' }));

    const brief = getBrief(wsId, 'brief_find');
    expect(brief).toBeDefined();
    expect(brief!.id).toBe('brief_find');
    expect(brief!.targetKeyword).toBe('findable keyword');
  });

  it('returns undefined for non-existent brief', () => {
    expect(getBrief(wsId, 'brief_nonexistent')).toBeUndefined();
  });
});

// ── updateBrief ──

describe('updateBrief', () => {
  const wsId = 'ws_brief_update_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('updates brief fields', () => {
    seedBrief(wsId, makeBrief('brief_upd', wsId));

    const updated = updateBrief(wsId, 'brief_upd', {
      suggestedTitle: 'Updated Title',
      wordCountTarget: 2500,
    });

    expect(updated).not.toBeNull();
    expect(updated!.suggestedTitle).toBe('Updated Title');
    expect(updated!.wordCountTarget).toBe(2500);
    // Original fields preserved
    expect(updated!.targetKeyword).toBe('test keyword');
  });

  it('returns null for non-existent brief', () => {
    expect(updateBrief(wsId, 'brief_nonexistent', { suggestedTitle: 'X' })).toBeNull();
  });

  it('preserves outline structure on update', () => {
    seedBrief(wsId, makeBrief('brief_outline', wsId));

    const updated = updateBrief(wsId, 'brief_outline', {
      outline: [
        { heading: 'New Section', notes: 'New notes', wordCount: 300 },
      ],
    });

    expect(updated!.outline).toHaveLength(1);
    expect(updated!.outline[0].heading).toBe('New Section');
  });
});

// ── deleteBrief ──

describe('deleteBrief', () => {
  const wsId = 'ws_brief_delete_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('removes a brief', () => {
    seedBrief(wsId, makeBrief('brief_del', wsId));
    expect(deleteBrief(wsId, 'brief_del')).toBe(true);
    expect(getBrief(wsId, 'brief_del')).toBeUndefined();
  });

  it('returns false for non-existent brief', () => {
    expect(deleteBrief(wsId, 'brief_nonexistent')).toBe(false);
  });
});

// ── ContentBrief interface shape ──

describe('ContentBrief shape', () => {
  const wsId = 'ws_brief_shape_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('supports v2 enhanced fields', () => {
    const brief = makeBrief('brief_v2', wsId, {
      executiveSummary: 'This content matters because...',
      contentFormat: 'guide',
      toneAndStyle: 'authoritative but approachable',
      peopleAlsoAsk: ['What is X?', 'How does X work?'],
      topicalEntities: ['entity1', 'entity2'],
      serpAnalysis: { contentType: 'guide', avgWordCount: 2000, commonElements: ['tables'], gaps: ['video'] },
      difficultyScore: 45,
      trafficPotential: 'high',
      ctaRecommendations: ['Download guide', 'Contact us'],
    });

    seedBrief(wsId, brief);
    const fetched = getBrief(wsId, 'brief_v2');
    expect(fetched!.executiveSummary).toBe('This content matters because...');
    expect(fetched!.serpAnalysis!.avgWordCount).toBe(2000);
  });

  it('supports v3 EEAT fields', () => {
    const brief = makeBrief('brief_v3', wsId, {
      eeatGuidance: { experience: 'Show real examples', expertise: 'Cite credentials', authority: 'Link authoritative sources', trust: 'Include testimonials' },
      contentChecklist: ['Include data', 'Add examples'],
      schemaRecommendations: [{ type: 'Article', notes: 'Use BlogPosting' }],
    });

    seedBrief(wsId, brief);
    const fetched = getBrief(wsId, 'brief_v3');
    expect(fetched!.eeatGuidance!.experience).toBe('Show real examples');
    expect(fetched!.contentChecklist).toHaveLength(2);
  });

  it('supports v4 pageType field', () => {
    const brief = makeBrief('brief_v4', wsId, { pageType: 'landing' });
    seedBrief(wsId, brief);
    const fetched = getBrief(wsId, 'brief_v4');
    expect(fetched!.pageType).toBe('landing');
  });

  it('supports v5 reference URLs and real SERP data', () => {
    const brief = makeBrief('brief_v5', wsId, {
      referenceUrls: ['https://competitor.com/guide'],
      realPeopleAlsoAsk: ['How much does X cost?'],
      realTopResults: [{ position: 1, title: 'Top Result', url: 'https://example.com' }],
    });

    seedBrief(wsId, brief);
    const fetched = getBrief(wsId, 'brief_v5');
    expect(fetched!.referenceUrls).toHaveLength(1);
    expect(fetched!.realTopResults![0].position).toBe(1);
  });
});

// ── buildStrategyCardBlock ──

describe('buildStrategyCardBlock', () => {
  it('returns empty string when context is undefined', () => {
    expect(buildStrategyCardBlock(undefined)).toBe('');
  });

  it('includes rationale when provided', () => {
    const block = buildStrategyCardBlock({
      rationale: 'High-volume gap with no existing page',
      intent: 'informational',
      priority: 'high',
      journeyStage: 'awareness',
    });
    expect(block).toContain('High-volume gap with no existing page');
    expect(block).toContain('informational');
    expect(block).toContain('high');
    expect(block).toContain('awareness');
  });

  it('omits fields that are undefined', () => {
    const block = buildStrategyCardBlock({ rationale: 'Only rationale set' });
    expect(block).toContain('Only rationale set');
    expect(block).not.toContain('undefined');
  });

  it('returns empty string when context has no fields set', () => {
    expect(buildStrategyCardBlock({})).toBe('');
  });
});

// ── getPageTypeConfig coverage ──

describe('getPageTypeConfig coverage', () => {
  const PAGE_TYPES = ['blog', 'landing', 'service', 'location', 'pillar', 'product', 'resource'];

  it('returns a config for every supported page type', () => {
    for (const pt of PAGE_TYPES) {
      const cfg = getPageTypeConfig(pt);
      expect(cfg).toBeDefined();
      expect(typeof cfg.wordCountTarget).toBe('number');
      expect(cfg.wordCountTarget).toBeGreaterThan(0);
      expect(typeof cfg.contentStyle).toBe('string');
      expect(cfg.contentStyle.length).toBeGreaterThan(0);
      expect(typeof cfg.prompt).toBe('string');
      expect(cfg.prompt.length).toBeGreaterThan(0);
    }
  });

  it('blog config has wordCountTarget >= 1400', () => {
    expect(getPageTypeConfig('blog').wordCountTarget).toBeGreaterThanOrEqual(1400);
  });

  it('landing config has wordCountTarget <= 1000', () => {
    expect(getPageTypeConfig('landing').wordCountTarget).toBeLessThanOrEqual(1000);
  });
});
