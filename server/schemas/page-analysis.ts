import { z } from '../middleware/validate.js';

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
}).strip();

export type PageAnalysisAiResult = z.infer<typeof pageAnalysisAiResultSchema>;

export const keywordAnalysisPersistSchema = z.object({
  workspaceId: z.string().trim().min(1),
  pagePath: z.string().trim().min(1),
  pageTitle: z.string().trim().optional(),
  analysis: pageAnalysisAiResultSchema,
}).strip();
