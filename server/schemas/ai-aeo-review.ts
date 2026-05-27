/**
 * Zod schemas for AI-generated AEO page review outputs.
 *
 * The `aeoReviewSchema` and `normalizeAeoReviewResponse` already live in
 * `server/aeo-page-review.ts`. This module provides a thin parse wrapper
 * that combines `parseAIJson` + the existing schema so the bare `JSON.parse`
 * call in `reviewPage()` can be replaced with a typed path.
 */
import { z } from '../middleware/validate.js';
import { parseAIJson } from '../openai-helpers.js';
import {
  AEO_CHANGE_TYPES,
  AEO_EFFORTS,
} from '../../shared/types/aeo.js';

// ── Re-export canonical schema for operation registry reference ─────────────

const aeoPageChangeStrictSchema = z.object({
  id: z.string().optional(),
  changeType: z.enum(AEO_CHANGE_TYPES).catch('copy_edit'),
  location: z.string().catch('Page content'),
  currentContent: z.string().optional(),
  suggestedChange: z.string().catch('Review this page section and update the copy for clearer answer-engine readability.'),
  rationale: z.string().catch('Improves answer-engine readability.'),
  effort: z.preprocess(
    (val) => {
      if (typeof val !== 'string') return val;
      const v = val.toLowerCase();
      if (v === 'low' || v === 'quick' || v === 'easy') return 'quick';
      if (v === 'high' || v === 'significant' || v === 'complex' || v === 'hard') return 'significant';
      return 'moderate';
    },
    z.enum(AEO_EFFORTS),
  ),
  priority: z.enum(['high', 'medium', 'low']).catch('medium'),
  aeoImpact: z.string().catch('Improves the page structure for AI answer extraction.'),
  verifiedSourceEvidence: z.string().optional(),
  requiresSourceResearch: z.boolean().optional(),
}).passthrough();

/**
 * Schema for the AEO page review AI response.
 * Mirrors the aeoReviewSchema in aeo-page-review.ts but used here for
 * the typed parse wrapper. The .catch() calls match the existing schema's
 * tolerant fallback behaviour.
 */
export const aiAeoReviewSchema = z.object({
  overallScore: z.number().min(0).max(100).catch(0),
  summary: z.string().catch('AEO review completed.'),
  changes: z.array(aeoPageChangeStrictSchema).catch([]),
  quickWinCount: z.number().int().min(0).optional(),
  estimatedTimeMinutes: z.number().int().min(0).optional(),
}).passthrough();

export type AiAeoReview = z.infer<typeof aiAeoReviewSchema>;

/**
 * Parse and validate the AEO page review AI response.
 * Throws on malformed JSON; tolerant of missing optional fields.
 */
export function parseAeoReview(rawText: string): AiAeoReview {
  const raw = parseAIJson<unknown>(rawText);
  return aiAeoReviewSchema.parse(raw);
}
