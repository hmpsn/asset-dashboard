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
