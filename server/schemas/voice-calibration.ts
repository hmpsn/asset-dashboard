import { z } from '../middleware/validate.js';
import { VOICE_SAMPLE_SOURCES } from '../../shared/types/brand-engine.js';
import { VOICE_FINALIZATION_LIMITS } from '../../shared/types/voice-finalization.js';
import {
  boundedMutableContextModifiersSchema,
  boundedMutableVoiceDNASchema,
  boundedMutableVoiceGuardrailsSchema,
} from '../../shared/types/voice-finalization-schemas.js';

export {
  createVoiceFinalizationAuthorizationBodySchema,
  finalizeBrandVoiceBodySchema,
} from '../../shared/types/voice-finalization-schemas.js';
export type {
  CreateVoiceFinalizationAuthorizationBody,
  FinalizeBrandVoiceBody,
} from '../../shared/types/voice-finalization-schemas.js';

export const createVoiceProfileSchema = z.object({}).strict();

export const getBrandVoiceReadinessQuerySchema = z.object({
  anchorLimit: z.coerce.number()
    .int()
    .min(1)
    .max(VOICE_FINALIZATION_LIMITS.maxEligibleAnchorPageSize)
    .optional(),
  anchorCursor: z.string()
    .min(1)
    .max(VOICE_FINALIZATION_LIMITS.maxAnchorCursorLength)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
}).strict();

const voiceSampleContentSchema = z.string()
  .trim()
  .min(1)
  .max(VOICE_FINALIZATION_LIMITS.maxTextLength)
  .refine(
    value => new TextEncoder().encode(value).byteLength
      <= VOICE_FINALIZATION_LIMITS.maxTextLength,
    `Voice sample content exceeds ${VOICE_FINALIZATION_LIMITS.maxTextLength} UTF-8 bytes.`,
  );

export const voiceSampleInputSchema = z.object({
  content: voiceSampleContentSchema,
  contextTag: z.enum(['headline', 'body', 'cta', 'about', 'service', 'social', 'seo'])
    .optional(),
  source: z.enum(VOICE_SAMPLE_SOURCES).optional(),
}).strict();

export const attestVoiceSampleSchema = z.object({
  expectedProfileRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

export const attestVoiceSamplesSchema = z.object({
  expectedProfileRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sampleIds: z.array(z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxIdLength))
    .min(1)
    .refine(ids => new Set(ids).size === ids.length, 'sampleIds must be unique'),
}).strict();

export const updateVoiceProfileSchema = z.object({
  // Keep the complete persisted status vocabulary at the validation boundary.
  // The domain service rejects attempts to claim `calibrated` so callers retain
  // the established VoiceProfileStateTransitionError contract.
  status: z.enum(['draft', 'calibrating', 'calibrated']).optional(),
  voiceDNA: boundedMutableVoiceDNASchema.optional(),
  guardrails: boundedMutableVoiceGuardrailsSchema.optional(),
  contextModifiers: boundedMutableContextModifiersSchema.optional(),
}).strict();

export const saveVariationFeedbackSchema = z.object({
  // Session IDs are `cal_<8hex>` format (not full UUIDs) — accept any non-empty string.
  sessionId: z.string().min(1).max(100),
  variationIndex: z.number().int().min(0).max(100),
  feedback: z.string().min(1).max(2000),
});

export const variationFeedbackItemSchema = z.object({
  variationIndex: z.number().int().min(0),
  feedback: z.string().min(1).max(2000),
  createdAt: z.string(),
});
