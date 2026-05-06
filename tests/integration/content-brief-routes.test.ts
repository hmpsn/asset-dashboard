/**
 * Integration tests for content brief HTTP routes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { getBrief } from '../../server/content-brief.js';
import type { ContentBrief } from '../../shared/types/content.js';

const ctx = createTestContext(13347); // port-ok: 13201-13346 already allocated in integration suite
const { api, patchJson } = ctx;

let testWsId = '';
const briefId = `brief_route_${Date.now()}`;

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    id: briefId,
    workspaceId: testWsId,
    targetKeyword: 'local seo services',
    secondaryKeywords: ['local seo', 'seo agency'],
    suggestedTitle: 'Local SEO Services Guide',
    suggestedMetaDesc: 'A practical guide to local SEO services.',
    outline: [
      { heading: 'Introduction', notes: 'Set up the local SEO problem.', wordCount: 200, keywords: ['local seo'] },
      { heading: 'How Local SEO Works', notes: 'Explain the major ranking factors.', wordCount: 500, keywords: ['seo agency'] },
    ],
    wordCountTarget: 1400,
    intent: 'commercial',
    audience: 'Local business owners',
    competitorInsights: 'Competitors focus on map pack rankings.',
    internalLinkSuggestions: ['/services/seo'],
    createdAt: new Date().toISOString(),
    pageType: 'service',
    ...overrides,
  };
}

function seedBrief(brief: ContentBrief): void {
  db.prepare(`
    INSERT INTO content_briefs
      (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
       suggested_meta_desc, outline, word_count_target, intent, audience,
       competitor_insights, internal_link_suggestions, created_at,
       executive_summary, content_format, tone_and_style, people_also_ask,
       topical_entities, serp_analysis, difficulty_score, traffic_potential,
       cta_recommendations, eeat_guidance, content_checklist, schema_recommendations,
       page_type, reference_urls, real_people_also_ask, real_top_results,
       keyword_locked, keyword_source, keyword_validation, template_id,
       title_variants, meta_desc_variants)
    VALUES
      (@id, @workspace_id, @target_keyword, @secondary_keywords, @suggested_title,
       @suggested_meta_desc, @outline, @word_count_target, @intent, @audience,
       @competitor_insights, @internal_link_suggestions, @created_at,
       @executive_summary, @content_format, @tone_and_style, @people_also_ask,
       @topical_entities, @serp_analysis, @difficulty_score, @traffic_potential,
       @cta_recommendations, @eeat_guidance, @content_checklist, @schema_recommendations,
       @page_type, @reference_urls, @real_people_also_ask, @real_top_results,
       @keyword_locked, @keyword_source, @keyword_validation, @template_id,
       @title_variants, @meta_desc_variants)
  `).run({
    id: brief.id,
    workspace_id: brief.workspaceId,
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
    keyword_locked: brief.keywordLocked ? 1 : 0,
    keyword_source: brief.keywordSource ?? null,
    keyword_validation: brief.keywordValidation ? JSON.stringify(brief.keywordValidation) : null,
    template_id: brief.templateId ?? null,
    title_variants: brief.titleVariants ? JSON.stringify(brief.titleVariants) : null,
    meta_desc_variants: brief.metaDescVariants ? JSON.stringify(brief.metaDescVariants) : null,
  });
}

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Content Brief Routes Test Workspace');
  testWsId = ws.id;
  seedBrief(makeBrief());
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(testWsId);
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

describe('Content Briefs — update route validation', () => {
  it('PATCH updates editable fields while ignoring immutable identity fields', async () => {
    const res = await patchJson(`/api/content-briefs/${testWsId}/${briefId}`, {
      id: 'brief_spoofed',
      workspaceId: 'ws_spoofed',
      createdAt: '1999-01-01T00:00:00.000Z',
      suggestedTitle: 'Updated Local SEO Services Guide',
      secondaryKeywords: ['map pack seo', 'local rankings'],
      pageType: 'landing',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(briefId);
    expect(body.workspaceId).toBe(testWsId);
    expect(body.createdAt).not.toBe('1999-01-01T00:00:00.000Z');
    expect(body.suggestedTitle).toBe('Updated Local SEO Services Guide');
    expect(body.secondaryKeywords).toEqual(['map pack seo', 'local rankings']);
    expect(body.pageType).toBe('landing');

    const persisted = getBrief(testWsId, briefId);
    expect(persisted?.id).toBe(briefId);
    expect(persisted?.workspaceId).toBe(testWsId);
    expect(persisted?.suggestedTitle).toBe('Updated Local SEO Services Guide');
  });

  it('PATCH rejects invalid structured fields without mutating the brief', async () => {
    const before = getBrief(testWsId, briefId);

    const res = await patchJson(`/api/content-briefs/${testWsId}/${briefId}`, {
      outline: 'replace outline with a string',
      secondaryKeywords: 'not an array',
      pageType: 'press-release',
    });

    expect(res.status).toBe(400);
    const after = getBrief(testWsId, briefId);
    expect(after?.outline).toEqual(before?.outline);
    expect(after?.secondaryKeywords).toEqual(before?.secondaryKeywords);
    expect(after?.pageType).toBe(before?.pageType);
  });

  it('GET /api/content-briefs/:workspaceId/:briefId returns 404 for missing briefs', async () => {
    const res = await api(`/api/content-briefs/${testWsId}/brief_missing`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Brief not found');
  });
});
