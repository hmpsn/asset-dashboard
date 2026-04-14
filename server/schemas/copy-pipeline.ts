// server/schemas/copy-pipeline.ts
// Zod schemas for copy pipeline JSON columns (used by parseJsonSafe/parseJsonSafeArray)
// and route body validation (used by validate() middleware).
import { z } from '../middleware/validate.js';

// ── JSON column schemas (for parseJsonSafe / parseJsonSafeArray) ──

export const steeringEntrySchema = z.object({
  type: z.enum(['note', 'highlight', 'summary']),
  note: z.string(),
  highlight: z.string().optional(),
  resultVersion: z.number().int(),
  timestamp: z.string(),
});

export const clientSuggestionSchema = z.object({
  originalText: z.string(),
  suggestedText: z.string(),
  status: z.enum(['pending', 'accepted', 'rejected', 'modified']),
  reviewNote: z.string().optional(),
  timestamp: z.string(),
});

export const qualityFlagSchema = z.object({
  type: z.enum(['forbidden_phrase', 'keyword_stuffing', 'word_count_violation', 'missing_element', 'guardrail_violation']),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
});

export const batchProgressSchema = z.object({
  total: z.number().int(),
  generated: z.number().int(),
  reviewed: z.number().int(),
  approved: z.number().int(),
});

export const copySectionStatusSchema = z.enum([
  'pending', 'draft', 'client_review', 'approved', 'revision_requested',
]);

export const intelligencePatternTypeSchema = z.enum([
  'terminology', 'tone', 'structure', 'keyword_usage',
]);

// ── Route body validation schemas ──

export const generateCopySchema = z.object({
  accumulatedSteering: z.array(z.string().max(2000)).max(50).optional(),
});

export const regenerateSectionSchema = z.object({
  note: z.string().min(1),
  highlight: z.string().optional(),
});

export const updateSectionStatusSchema = z.object({
  status: copySectionStatusSchema,
});

export const updateSectionTextSchema = z.object({
  copy: z.string().min(1),
});

export const addSuggestionSchema = z.object({
  originalText: z.string().min(1),
  suggestedText: z.string().min(1),
});

export const updatePatternSchema = z.object({
  active: z.boolean().optional(),
  pattern: z.string().optional(),
  patternType: intelligencePatternTypeSchema.optional(),
});

export const extractPatternsSchema = z.object({
  steeringNotes: z.array(z.string().max(2000)).min(1).max(50),
});

export const startBatchSchema = z.object({
  entryIds: z.array(z.string()).min(1).max(100),
  mode: z.enum(['review_inbox', 'iterative']).optional(),
  batchSize: z.number().int().positive().optional(),
});

export const exportCopySchema = z.object({
  format: z.enum(['webflow_cms', 'csv', 'copy_deck']),
  scope: z.enum(['all', 'selected', 'single']),
  entryIds: z.array(z.string()).optional(),
  entryId: z.string().optional(),
  webflowSiteId: z.string().optional(),
  docFormat: z.enum(['google', 'word']).optional(),
}).refine(
  (data) => data.scope !== 'selected' || (data.entryIds && data.entryIds.length > 0),
  { message: 'entryIds required when scope is selected', path: ['entryIds'] },
).refine(
  (data) => data.scope !== 'single' || !!data.entryId,
  { message: 'entryId required when scope is single', path: ['entryId'] },
);
