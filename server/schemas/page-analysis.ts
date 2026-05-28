import { z } from '../middleware/validate.js';
import {
  EEAT_ASSET_TYPE,
  EEAT_RECOMMENDATION_SURFACE,
  TRUST_SIGNAL_SEVERITY,
} from '../../shared/types/eeat-assets.js';

const stringArraySchema = z.array(z.string().trim().min(1)).catch([]);

export const pageAnalysisAiResultSchema = z.object({
  primaryKeyword: z.string().trim().catch(''),
  primaryKeywordPresence: z.object({
    inTitle: z.boolean().catch(false),
    inMeta: z.boolean().catch(false),
    inContent: z.boolean().catch(false),
    inSlug: z.boolean().catch(false),
  }).optional().catch(undefined),
  secondaryKeywords: stringArraySchema,
  longTailKeywords: stringArraySchema,
  contentGaps: stringArraySchema,
  competitorKeywords: stringArraySchema,
  optimizationIssues: stringArraySchema,
  recommendations: stringArraySchema,
  searchIntent: z.enum(['informational', 'transactional', 'navigational', 'commercial']).catch('informational'),
  searchIntentConfidence: z.number().min(0).max(1).optional().catch(undefined),
  optimizationScore: z.number().min(0).max(100).optional().catch(undefined),
  estimatedDifficulty: z.enum(['low', 'medium', 'high']).optional().catch(undefined),
  keywordDifficulty: z.number().min(0).max(100).catch(0),
  monthlyVolume: z.number().min(0).catch(0),
  topicCluster: z.string().trim().optional().catch(undefined),
  missingTrustSignals: z.array(z.object({
    signal: z.string().trim().min(1),
    rationale: z.string().trim().min(1),
    severity: z.enum([
      TRUST_SIGNAL_SEVERITY.HIGH,
      TRUST_SIGNAL_SEVERITY.MEDIUM,
      TRUST_SIGNAL_SEVERITY.LOW,
    ]),
    recommendedAssetTypes: z.array(z.enum([
      EEAT_ASSET_TYPE.TESTIMONIAL,
      EEAT_ASSET_TYPE.CASE_STUDY,
      EEAT_ASSET_TYPE.CREDENTIAL,
      EEAT_ASSET_TYPE.BEFORE_AFTER_GALLERY,
      EEAT_ASSET_TYPE.TEAM_BIO,
      EEAT_ASSET_TYPE.AWARD,
      EEAT_ASSET_TYPE.RESEARCH,
      EEAT_ASSET_TYPE.CLIENT_LOGO,
    ])).catch([]),
  }).strip()).optional().catch(undefined),
  eeatAssetRecommendations: z.array(z.object({
    assetId: z.string().trim().min(1),
    type: z.enum([
      EEAT_ASSET_TYPE.TESTIMONIAL,
      EEAT_ASSET_TYPE.CASE_STUDY,
      EEAT_ASSET_TYPE.CREDENTIAL,
      EEAT_ASSET_TYPE.BEFORE_AFTER_GALLERY,
      EEAT_ASSET_TYPE.TEAM_BIO,
      EEAT_ASSET_TYPE.AWARD,
      EEAT_ASSET_TYPE.RESEARCH,
      EEAT_ASSET_TYPE.CLIENT_LOGO,
    ]),
    title: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    surface: z.enum([
      EEAT_RECOMMENDATION_SURFACE.CONTENT_BRIEF,
      EEAT_RECOMMENDATION_SURFACE.PAGE_INTELLIGENCE,
      EEAT_RECOMMENDATION_SURFACE.SCHEMA,
    ]),
    url: z.string().trim().optional(),
  }).strip()).optional().catch(undefined),
}).strip();

export type PageAnalysisAiResult = z.infer<typeof pageAnalysisAiResultSchema>;

export const keywordAnalysisPersistSchema = z.object({
  workspaceId: z.string().trim().min(1),
  pagePath: z.string().trim().min(1),
  pageTitle: z.string().trim().optional(),
  analysis: pageAnalysisAiResultSchema,
}).strip();
