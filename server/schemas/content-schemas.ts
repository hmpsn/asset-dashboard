/**
 * Zod schemas for content brief and content post JSON columns.
 * Used by content-brief.ts and content-posts-db.ts row mappers.
 */
import { z } from 'zod';

// ── Content Brief schemas ──

export const outlineItemSchema = z.object({
  heading: z.string(),
  subheadings: z.array(z.string()).optional(),
  notes: z.string(),
  wordCount: z.number().optional(),
  keywords: z.array(z.string()).optional(),
}).passthrough();

export const serpAnalysisSchema = z.object({
  contentType: z.string(),
  avgWordCount: z.number(),
  commonElements: z.array(z.string()),
  gaps: z.array(z.string()),
}).passthrough();

export const eeatGuidanceSchema = z.object({
  experience: z.string(),
  expertise: z.string(),
  authority: z.string(),
  trust: z.string(),
}).passthrough();

export const schemaRecommendationSchema = z.object({
  type: z.string(),
  notes: z.string(),
}).passthrough();

export const keywordValidationSchema = z.object({
  volume: z.number(),
  difficulty: z.number(),
  cpc: z.number(),
  validatedAt: z.string(),
}).passthrough();

export const realTopResultSchema = z.object({
  position: z.number(),
  title: z.string(),
  url: z.string(),
}).passthrough();

// ── Brief source evidence (C4, audit #16) ──
// Field names cross-referenced against BriefScrapedSource / BriefSourceEvidence
// in shared/types/content.ts. Evidence arrays are .optional() because the write
// path (buildBriefSourceEvidence in content-brief-generation-job.ts) omits empty
// sections — schema-vs-stored-shape rule.

export const briefScrapedSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  metaDescription: z.string(),
  headings: z.array(z.object({ level: z.number(), text: z.string() })),
  bodyText: z.string(),
  wordCount: z.number(),
  fetchedAt: z.string(),
}).passthrough();

export const briefSourceEvidenceSchema = z.object({
  scrapedReferences: z.array(briefScrapedSourceSchema).optional(),
  serpResults: z.array(z.object({
    position: z.number(),
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
  })).optional(),
  serpFetchedAt: z.string().optional(),
  styleExamples: z.array(briefScrapedSourceSchema).optional(),
  capturedAt: z.string(),
}).passthrough();

// ── Content Post schemas ──

export const postSectionSchema = z.object({
  index: z.number(),
  heading: z.string(),
  content: z.string(),
  wordCount: z.number(),
  targetWordCount: z.number(),
  keywords: z.array(z.string()),
  status: z.enum(['pending', 'generating', 'done', 'error']),
  error: z.string().optional(),
}).passthrough();

export const postSectionsArraySchema = z.array(postSectionSchema);

export const reviewChecklistSchema = z.object({
  factual_accuracy: z.boolean(),
  brand_voice: z.boolean(),
  internal_links: z.boolean(),
  no_hallucinations: z.boolean(),
  meta_optimized: z.boolean(),
  word_count_target: z.boolean(),
}).passthrough();

// ── Stored AI review (C4, audit #16) ──
// Field names cross-referenced against StoredAIReview / AIReviewResult /
// ContentReviewEvidence in shared/types/content.ts. `evidence` and `model` are
// .optional() because the write path omits them when unavailable —
// schema-vs-stored-shape rule.

const storedAiReviewResultSchema = z.object({
  pass: z.boolean(),
  reason: z.string(),
  humanReviewRequired: z.boolean().optional(),
  claimsToVerify: z.array(z.string()).optional(),
  claimEvidence: z.array(z.object({
    claim: z.string(),
    sourceCandidates: z.array(z.object({
      kind: z.enum(['reference_url', 'serp_top_result', 'paa', 'manual_unknown']),
      label: z.string(),
      url: z.string().optional(),
      position: z.number().optional(),
      confidence: z.enum(['strong', 'possible']).optional(),
      matchReason: z.string().optional(),
    }).passthrough()),
  }).passthrough()).optional(),
}).passthrough();

export const storedAiReviewSchema = z.object({
  review: z.object({
    factual_accuracy: storedAiReviewResultSchema,
    brand_voice: storedAiReviewResultSchema,
    internal_links: storedAiReviewResultSchema,
    no_hallucinations: storedAiReviewResultSchema,
    meta_optimized: storedAiReviewResultSchema,
    word_count_target: storedAiReviewResultSchema,
  }).passthrough(),
  evidence: z.object({
    referenceUrls: z.array(z.string()).optional(),
    peopleAlsoAsk: z.array(z.string()),
    topResults: z.array(z.object({ position: z.number(), title: z.string(), url: z.string() }).passthrough()),
    note: z.string(),
  }).passthrough().optional(),
  reviewedAt: z.string(),
  model: z.string().optional(),
}).passthrough();
