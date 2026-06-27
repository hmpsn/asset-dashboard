import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import {
  outlineItemSchema, serpAnalysisSchema, eeatGuidanceSchema,
  schemaRecommendationSchema, keywordValidationSchema, realTopResultSchema,
  briefSourceEvidenceSchema,
} from './schemas/content-schemas.js';
import { resolveContentGenerationStyle } from './page-type-copy-contract.js';
import { z } from 'zod';
import type { ContentBrief } from '../shared/types/content.js';

interface BriefRow {
  id: string;
  workspace_id: string;
  target_keyword: string;
  secondary_keywords: string;
  suggested_title: string;
  suggested_meta_desc: string;
  outline: string;
  word_count_target: number;
  intent: string;
  audience: string;
  competitor_insights: string;
  internal_link_suggestions: string;
  created_at: string;
  executive_summary: string | null;
  content_format: string | null;
  tone_and_style: string | null;
  people_also_ask: string | null;
  topical_entities: string | null;
  serp_analysis: string | null;
  difficulty_score: number | null;
  traffic_potential: string | null;
  cta_recommendations: string | null;
  eeat_guidance: string | null;
  content_checklist: string | null;
  schema_recommendations: string | null;
  page_type: string | null;
  reference_urls: string | null;
  real_people_also_ask: string | null;
  real_top_results: string | null;
  keyword_locked: number | null;
  keyword_source: string | null;
  keyword_validation: string | null;
  template_id: string | null;
  title_variants: string | null;
  meta_desc_variants: string | null;
  generation_style: string | null;
  source_evidence: string | null;
  superseded_by: string | null;
}

const stmts = createStmtCache(() => ({
  selectByWorkspace: db.prepare(
    `SELECT * FROM content_briefs WHERE workspace_id = ? AND superseded_by IS NULL ORDER BY created_at DESC`,
  ),
  selectByWorkspaceAll: db.prepare(
    `SELECT * FROM content_briefs WHERE workspace_id = ? ORDER BY created_at DESC`,
  ),
  selectById: db.prepare(
    `SELECT * FROM content_briefs WHERE id = ? AND workspace_id = ?`,
  ),
}));

function rowToBrief(row: BriefRow): ContentBrief {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    targetKeyword: row.target_keyword,
    secondaryKeywords: parseJsonSafeArray(row.secondary_keywords, z.string(), { field: 'secondary_keywords', table: 'content_briefs' }),
    suggestedTitle: row.suggested_title,
    suggestedMetaDesc: row.suggested_meta_desc,
    outline: parseJsonSafeArray(row.outline, outlineItemSchema, { field: 'outline', table: 'content_briefs' }),
    wordCountTarget: row.word_count_target,
    intent: row.intent,
    audience: row.audience,
    competitorInsights: row.competitor_insights,
    internalLinkSuggestions: parseJsonSafeArray(row.internal_link_suggestions, z.string(), { field: 'internal_link_suggestions', table: 'content_briefs' }),
    createdAt: row.created_at,
    executiveSummary: row.executive_summary ?? undefined,
    contentFormat: row.content_format ?? undefined,
    toneAndStyle: row.tone_and_style ?? undefined,
    peopleAlsoAsk: row.people_also_ask ? parseJsonSafeArray(row.people_also_ask, z.string(), { field: 'people_also_ask', table: 'content_briefs' }) : undefined,
    topicalEntities: row.topical_entities ? parseJsonSafeArray(row.topical_entities, z.string(), { field: 'topical_entities', table: 'content_briefs' }) : undefined,
    serpAnalysis: row.serp_analysis
      ? parseJsonSafe(row.serp_analysis, serpAnalysisSchema, null, { field: 'serp_analysis', table: 'content_briefs' }) ?? undefined
      : undefined,
    difficultyScore: row.difficulty_score ?? undefined,
    trafficPotential: row.traffic_potential ?? undefined,
    ctaRecommendations: row.cta_recommendations ? parseJsonSafeArray(row.cta_recommendations, z.string(), { field: 'cta_recommendations', table: 'content_briefs' }) : undefined,
    eeatGuidance: row.eeat_guidance
      ? parseJsonSafe(row.eeat_guidance, eeatGuidanceSchema, null, { field: 'eeat_guidance', table: 'content_briefs' }) ?? undefined
      : undefined,
    contentChecklist: row.content_checklist ? parseJsonSafeArray(row.content_checklist, z.string(), { field: 'content_checklist', table: 'content_briefs' }) : undefined,
    schemaRecommendations: row.schema_recommendations
      ? parseJsonSafeArray(row.schema_recommendations, schemaRecommendationSchema, { field: 'schema_recommendations', table: 'content_briefs' })
      : undefined,
    pageType: row.page_type as ContentBrief['pageType'] ?? undefined,
    referenceUrls: row.reference_urls ? parseJsonSafeArray(row.reference_urls, z.string(), { field: 'reference_urls', table: 'content_briefs' }) : undefined,
    realPeopleAlsoAsk: row.real_people_also_ask ? parseJsonSafeArray(row.real_people_also_ask, z.string(), { field: 'real_people_also_ask', table: 'content_briefs' }) : undefined,
    realTopResults: row.real_top_results
      ? parseJsonSafeArray(row.real_top_results, realTopResultSchema, { field: 'real_top_results', table: 'content_briefs' })
      : undefined,
    keywordLocked: row.keyword_locked ? true : undefined,
    keywordSource: (row.keyword_source as ContentBrief['keywordSource']) ?? undefined,
    keywordValidation: row.keyword_validation
      ? parseJsonSafe(row.keyword_validation, keywordValidationSchema, null, { field: 'keyword_validation', table: 'content_briefs' }) ?? undefined
      : undefined,
    templateId: row.template_id ?? undefined,
    titleVariants: row.title_variants ? parseJsonSafeArray(row.title_variants, z.string(), { field: 'title_variants', table: 'content_briefs' }) : undefined,
    metaDescVariants: row.meta_desc_variants ? parseJsonSafeArray(row.meta_desc_variants, z.string(), { field: 'meta_desc_variants', table: 'content_briefs' }) : undefined,
    generationStyle: resolveContentGenerationStyle(row.generation_style),
    sourceEvidence: row.source_evidence
      ? parseJsonSafe(row.source_evidence, briefSourceEvidenceSchema, null, { workspaceId: row.workspace_id, field: 'source_evidence', table: 'content_briefs' }) ?? undefined
      : undefined,
    supersededBy: row.superseded_by ?? undefined,
  };
}

export function listBriefs(workspaceId: string, opts?: { includeSuperseded?: boolean }): ContentBrief[] {
  const rows = (opts?.includeSuperseded
    ? stmts().selectByWorkspaceAll.all(workspaceId)
    : stmts().selectByWorkspace.all(workspaceId)) as BriefRow[];
  return rows.map(rowToBrief);
}

export function getBrief(workspaceId: string, briefId: string): ContentBrief | undefined {
  const row = stmts().selectById.get(briefId, workspaceId) as BriefRow | undefined;
  return row ? rowToBrief(row) : undefined;
}
