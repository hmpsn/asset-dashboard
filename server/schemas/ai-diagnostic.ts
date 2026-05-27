/**
 * Zod schema for AI-generated diagnostic orchestrator outputs.
 *
 * The diagnostic orchestrator calls `callAI` and then bare-`JSON.parse`s the
 * result text, then manually extracts rootCauses / remediationActions via
 * `parseJsonSafeArray`. This module provides a typed top-level parse wrapper
 * that validates the full response object in one step.
 */
import { z } from '../middleware/validate.js';
import { parseAIJson } from '../openai-helpers.js';
import { rootCauseSchema, remediationActionSchema } from './diagnostics-schemas.js';

/**
 * Schema for the root-cause-analysis AI response.
 * The model returns an object with four fields matching the prompt schema.
 */
export const aiRootCauseAnalysisSchema = z.object({
  rootCauses: z.array(rootCauseSchema).optional().default([]),
  remediationActions: z.array(remediationActionSchema).optional().default([]),
  adminReport: z.string().optional().default(''),
  clientSummary: z.string().optional().default(''),
}).passthrough();

export type AiRootCauseAnalysis = z.infer<typeof aiRootCauseAnalysisSchema>;

/**
 * Parse and validate the root-cause-analysis AI response.
 * Throws on malformed JSON; tolerant of missing/empty fields.
 */
export function parseDiagnosticRootCauses(rawText: string): AiRootCauseAnalysis {
  const raw = parseAIJson<unknown>(rawText);
  return aiRootCauseAnalysisSchema.parse(raw);
}
