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
  updateBriefAtRevision,
  bumpBriefGenerationRevision,
  deleteBrief,
  deleteBriefAtRevision,
  buildStrategyCardBlock,
  getPageTypeConfig,
  normalizeOutlineForPageType,
  type ContentBrief,
} from '../../server/content-brief.js';
import { getPageTypeOutlineGuidance } from '../../server/page-type-copy-contract.js';
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

  it('increments generation revision once for a real edit and not for a no-op', () => {
    seedBrief(wsId, makeBrief('brief_revision_edit', wsId));
    const initial = getBrief(wsId, 'brief_revision_edit')!;
    expect(initial.generationRevision).toBe(0);

    const changed = updateBrief(wsId, initial.id, { suggestedTitle: 'Human title' })!;
    expect(changed.generationRevision).toBe(1);
    const noOp = updateBrief(wsId, initial.id, {
      suggestedTitle: 'Human title',
      outline: changed.outline.map(section => ({ ...section })),
    })!;
    expect(noOp.generationRevision).toBe(1);
  });

  it('applies expected-revision edits atomically and rejects stale callers', () => {
    seedBrief(wsId, makeBrief('brief_expected_edit', wsId));
    const changed = updateBriefAtRevision(
      wsId,
      'brief_expected_edit',
      0,
      { suggestedTitle: 'First writer' },
    )!;
    expect(changed.generationRevision).toBe(1);
    expect(() => updateBriefAtRevision(
      wsId,
      'brief_expected_edit',
      0,
      { suggestedTitle: 'Stale writer' },
    )).toThrow('changed while generation was running');
    expect(getBrief(wsId, 'brief_expected_edit')?.suggestedTitle).toBe('First writer');
  });

  it('supports a revision-only authority bump for linked request decisions', () => {
    seedBrief(wsId, makeBrief('brief_linked_authority', wsId));
    const bumped = bumpBriefGenerationRevision(wsId, 'brief_linked_authority', 0)!;
    expect(bumped.generationRevision).toBe(1);
    expect(bumped.suggestedTitle).toBe('Test Brief Title');
  });

  it('preserves read-compatible legacy provenance during a human edit', () => {
    seedBrief(wsId, makeBrief('brief_legacy_provenance', wsId));
    const legacyProvenance = {
      runId: 'legacy-run',
      operation: 'legacy-content-brief',
      provider: 'openai',
      model: 'legacy-model',
      inputFingerprint: 'legacy descriptive fingerprint',
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:01.000Z',
    };
    db.prepare(
      `UPDATE content_briefs
       SET generation_provenance = ?
       WHERE id = ? AND workspace_id = ?`,
    ).run(JSON.stringify(legacyProvenance), 'brief_legacy_provenance', wsId);

    const updated = updateBrief(wsId, 'brief_legacy_provenance', {
      suggestedTitle: 'Human edit over legacy row',
    });

    expect(updated?.generationRevision).toBe(1);
    expect(updated?.generationProvenance).toEqual(legacyProvenance);
  });

  it('does not clear optional fields supplied as undefined beside a real edit', () => {
    seedBrief(wsId, makeBrief('brief_undefined_update', wsId, {
      executiveSummary: 'Keep this summary',
    }));

    const updated = updateBrief(wsId, 'brief_undefined_update', {
      suggestedTitle: 'Only this field changes',
      executiveSummary: undefined,
    });

    expect(updated?.suggestedTitle).toBe('Only this field changes');
    expect(updated?.executiveSummary).toBe('Keep this summary');
    expect(updated?.generationRevision).toBe(1);
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

  it('deletes only at the current revision', () => {
    seedBrief(wsId, makeBrief('brief_delete_revision', wsId));
    const updated = updateBrief(wsId, 'brief_delete_revision', {
      suggestedTitle: 'Revision one',
    })!;

    expect(() => deleteBriefAtRevision(wsId, updated.id, 0))
      .toThrow('changed while generation was running');
    expect(getBrief(wsId, updated.id)).toBeDefined();
    expect(deleteBriefAtRevision(wsId, updated.id, updated.generationRevision)).toBe(true);
    expect(getBrief(wsId, updated.id)).toBeUndefined();
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

  it('defaults and updates generationStyle', () => {
    seedBrief(wsId, makeBrief('brief_style_default', wsId));
    expect(getBrief(wsId, 'brief_style_default')!.generationStyle).toBe('standard');

    const updated = updateBrief(wsId, 'brief_style_default', { generationStyle: 'concise' });
    expect(updated!.generationStyle).toBe('concise');
    expect(getBrief(wsId, 'brief_style_default')!.generationStyle).toBe('concise');
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

  it('service config is conversion dense and shorter than blog content', () => {
    const cfg = getPageTypeConfig('service');
    expect(cfg.wordCountTarget).toBeLessThanOrEqual(1100);
    expect(cfg.wordCountRange).toBe('800-1,100');
    expect(cfg.prompt).toContain('single CTA');
    expect(cfg.prompt).toContain('do not add extra sections');
  });

  it('location config avoids reader-facing SEO operations guidance', () => {
    const cfg = getPageTypeConfig('location');
    expect(cfg.wordCountTarget).toBeLessThanOrEqual(1000);
    expect(cfg.wordCountRange).toBe('700-1,000');
    expect(cfg.prompt).not.toContain('NAP consistency');
    expect(cfg.prompt).not.toContain('Google Business Profile');
    expect(cfg.prompt).toContain('public-facing copy');
  });

  it.each(['blog', 'service', 'location', 'landing', 'product'])(
    'makes factual specifics evidence-conditional in the %s brief contract',
    pageType => {
      const cfg = getPageTypeConfig(pageType);
      expect(cfg.prompt).toContain('FACTUAL SPECIFICS AUTHORITY');
      expect(cfg.prompt).toContain('explicitly labeled verified provider, analytics, or source evidence');
      expect(cfg.prompt).toContain('omit unsupported specifics');
    },
  );

  it.each(['provider-profile', 'procedure-guide', 'pricing-page'])(
    'keeps healthcare facts and citations tied to supplied approved evidence in %s',
    pageType => {
      const cfg = getPageTypeConfig(pageType);
      expect(cfg.prompt).toContain('FACTUAL SPECIFICS AUTHORITY');
      expect(cfg.prompt).toContain('Do not invent credentials, affiliations, medical results, risks, prices, statistics, or citations');
    },
  );

  it('allows verified source evidence for medical and pricing facts while keeping first-party proof human-approved', () => {
    const provider = getPageTypeConfig('provider-profile').prompt;
    const procedure = getPageTypeConfig('procedure-guide').prompt;
    const pricing = getPageTypeConfig('pricing-page').prompt;

    expect(provider).toContain('Credentials, affiliations, patient results, and testimonials require human-approved first-party context');
    expect(procedure).toContain('Risks, prices, statistics, and citations require authoritative source evidence');
    expect(procedure).toContain('comparison table only when authoritative evidence supports');
    expect(pricing).toContain('authoritative price data');
    expect(pricing).toContain('comparison table only when authoritative evidence supports');
  });
});

// ── outline compression contracts ──

describe('outline compression contracts', () => {
  it('documents compact service outline rules without forcing every section to have H3s', () => {
    const guidance = getPageTypeOutlineGuidance('service');
    expect(guidance).toContain('OUTLINE COMPRESSION CONTRACT (service)');
    expect(guidance).toContain('4-5 useful H2 sections');
    expect(guidance).toContain('800-1,100 total words');
    expect(guidance).toContain('Subheadings are optional');
    expect(guidance).not.toContain('MUST include 2-3 subheadings');
  });

  it('documents compact location outline rules without reader-facing local SEO mechanics', () => {
    const guidance = getPageTypeOutlineGuidance('location');
    expect(guidance).toContain('OUTLINE COMPRESSION CONTRACT (location)');
    expect(guidance).toContain('700-1,000 total words');
    expect(guidance).toContain('Never teach local SEO mechanics');
    expect(guidance).not.toContain('NAP consistency');
    expect(guidance).not.toContain('Google Business Profile');
  });

  it('compresses service outlines by trimming duplicate closes, H3s, and total word count', () => {
    const outline: ContentBrief['outline'] = [
      { heading: 'What We Solve', notes: 'Answer the main buyer problem.', wordCount: 300, subheadings: ['A', 'B', 'C'], keywords: [] },
      { heading: 'What Is Included', notes: 'Cover deliverables.', wordCount: 320, subheadings: ['A', 'B', 'C'], keywords: [] },
      { heading: 'Our Process', notes: 'Explain the workflow.', wordCount: 320, subheadings: ['A', 'B'], keywords: [] },
      { heading: 'Book a Call', notes: 'Invite the reader to book a call.', wordCount: 160, subheadings: ['A'], keywords: [] },
      { heading: 'Proof and Fit', notes: 'Use selective proof.', wordCount: 280, subheadings: ['A', 'B', 'C'], keywords: [] },
      { heading: 'Contact Us', notes: 'Repeat contact and discovery details.', wordCount: 160, subheadings: ['A'], keywords: [] },
      { heading: 'Conclusion', notes: 'Close the article.', wordCount: 180, subheadings: ['A'], keywords: [] },
    ];

    const normalized = normalizeOutlineForPageType(outline, 'service');
    const closingSections = normalized.filter(item => /book|contact|conclusion|next step/i.test(`${item.heading} ${item.notes}`));
    const totalWords = normalized.reduce((sum, item) => sum + (item.wordCount ?? 0), 0);

    expect(normalized).toHaveLength(5);
    expect(closingSections).toHaveLength(1);
    expect(totalWords).toBe(1000);
    expect(normalized.every(item => (item.subheadings?.length ?? 0) <= 2)).toBe(true);
    expect(normalized.at(-1)?.subheadings).toEqual([]);
  });

  it('sanitizes location outline SEO-operations language during normalization', () => {
    const normalized = normalizeOutlineForPageType([
      {
        heading: 'Local SEO and NAP Consistency',
        notes: 'Explain Google Business Profile hygiene, schema markup, citation cleanup, and directory listings.',
        wordCount: 400,
        subheadings: ['NAP cleanup', 'Schema markup', 'Google Business Profile'],
        keywords: ['branding agency austin'],
      },
      { heading: 'Services in Austin', notes: 'Cover services and local proof.', wordCount: 350, subheadings: ['A', 'B', 'C'], keywords: [] },
      { heading: 'Book a Discovery Call', notes: 'One local CTA close.', wordCount: 150, subheadings: ['A'], keywords: [] },
    ], 'location');

    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toMatch(/NAP/i);
    expect(serialized).not.toContain('schema markup');
    expect(serialized).not.toContain('Google Business Profile');
    expect(serialized).not.toContain('directory listings');
    expect(normalized.at(-1)?.subheadings).toEqual([]);
  });

  it('leaves blog outlines structurally deep', () => {
    const outline: ContentBrief['outline'] = [
      { heading: 'Deep Topic', notes: 'Teach the topic.', wordCount: 500, subheadings: ['A', 'B', 'C', 'D'], keywords: [] },
      { heading: 'More Depth', notes: 'Keep useful educational depth.', wordCount: 500, subheadings: ['A', 'B', 'C'], keywords: [] },
    ];

    expect(normalizeOutlineForPageType(outline, 'blog')).toEqual(outline);
  });
});
