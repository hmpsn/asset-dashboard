import { z } from 'zod';

import { VOICE_FINALIZATION_LIMITS } from './voice-finalization.js';

const shortTextSchema = z.string().trim().max(VOICE_FINALIZATION_LIMITS.maxShortTextLength);
const contentTextSchema = z.string().trim().max(VOICE_FINALIZATION_LIMITS.maxTextLength);
const expectedRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  .describe('Exact profile revision returned by get_brand_voice; stale writes are rejected.');

const workspaceIdSchema = z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxIdLength)
  .describe('The workspace whose finalized voice authority is being addressed.');
const anchorCursorSchema = z.string().trim().min(1)
  .max(VOICE_FINALIZATION_LIMITS.maxAnchorCursorLength)
  .regex(/^[A-Za-z0-9_-]+$/, 'anchor_cursor must be an opaque base64url token');

export const getBrandVoiceInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  anchor_limit: z.number().int().min(1)
    .max(VOICE_FINALIZATION_LIMITS.maxEligibleAnchorPageSize)
    .optional()
    .describe(`Eligible-anchor page size; defaults to ${VOICE_FINALIZATION_LIMITS.defaultEligibleAnchorPageSize} and caps at ${VOICE_FINALIZATION_LIMITS.maxEligibleAnchorPageSize}.`),
  anchor_cursor: anchorCursorSchema.optional()
    .describe('Opaque eligible-anchor cursor bound to the workspace, current voice-profile revision, current brand-intake revision, and stable page position.'),
}).strict();

export const createBrandVoiceProfileMcpInputSchema = z.object({
  workspace_id: workspaceIdSchema,
}).strict();

const mcpVoiceDnaSchema = z.object({
  personality_traits: z.array(shortTextSchema).max(VOICE_FINALIZATION_LIMITS.maxTraitCount)
    .describe('Specific voice personality traits; empty values remain empty.'),
  tone_spectrum: z.object({
    formal_casual: z.number().min(1).max(10)
      .describe('1 = most formal; 10 = most casual.'),
    serious_playful: z.number().min(1).max(10)
      .describe('1 = most serious; 10 = most playful.'),
    technical_accessible: z.number().min(1).max(10)
      .describe('1 = most technical; 10 = most accessible.'),
  }).strict().describe('Three calibrated tone axes on the platform 1–10 scale; higher values move toward the second named pole.'),
  sentence_style: contentTextSchema.describe('Sentence rhythm and construction guidance.'),
  vocabulary_level: contentTextSchema.describe('Vocabulary and reading-level guidance.'),
  humor_style: contentTextSchema.optional().describe('Optional humor guidance.'),
}).strict();

const mcpVoiceGuardrailsSchema = z.object({
  forbidden_words: z.array(shortTextSchema)
    .max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup)
    .describe('Words and phrases the voice must not use.'),
  required_terminology: z.array(z.object({
    use: shortTextSchema,
    instead_of: shortTextSchema,
  }).strict()).max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup)
    .describe('Preferred terminology and the wording it replaces.'),
  tone_boundaries: z.array(contentTextSchema)
    .max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup)
    .describe('Tone boundaries that must remain true.'),
  anti_patterns: z.array(contentTextSchema)
    .max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup)
    .describe('Recognizable off-brand writing patterns to avoid.'),
}).strict();

export const updateBrandVoiceDraftMcpInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  expected_profile_revision: expectedRevisionSchema,
  voice_dna: mcpVoiceDnaSchema.optional()
    .describe('Complete proposed voice DNA replacement.'),
  guardrails: mcpVoiceGuardrailsSchema.optional()
    .describe('Complete proposed voice guardrails replacement.'),
  context_modifiers: z.array(z.object({
    context: shortTextSchema,
    description: contentTextSchema,
  }).strict()).max(VOICE_FINALIZATION_LIMITS.maxContextModifiers).optional()
    .describe('Complete proposed context-specific voice modifier replacement.'),
}).strict().refine(
  value => value.voice_dna !== undefined
    || value.guardrails !== undefined
    || value.context_modifiers !== undefined,
  { message: 'At least one voice draft field is required.' },
);

export const addBrandVoiceSampleMcpInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  expected_profile_revision: expectedRevisionSchema,
  content: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxTextLength)
    .describe('Exact sample text to add to the voice profile.'),
  context: z.enum(['headline', 'body', 'cta', 'about', 'service', 'social', 'seo'])
    .optional().describe('Optional writing context for this sample.'),
}).strict();

export const finalizeBrandVoiceMcpInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  authorization_token: z.string().trim().min(1)
    .max(VOICE_FINALIZATION_LIMITS.maxAuthorizationTokenLength)
    .describe('One-time short-lived operator authorization bound to the exact voice profile revision, fields, anchors, ratings, and idempotency key.'),
}).strict();

export type GetBrandVoiceInput = z.infer<typeof getBrandVoiceInputSchema>;
export type CreateBrandVoiceProfileMcpInput = z.infer<typeof createBrandVoiceProfileMcpInputSchema>;
export type UpdateBrandVoiceDraftMcpInput = z.infer<typeof updateBrandVoiceDraftMcpInputSchema>;
export type AddBrandVoiceSampleMcpInput = z.infer<typeof addBrandVoiceSampleMcpInputSchema>;
export type FinalizeBrandVoiceMcpInput = z.infer<typeof finalizeBrandVoiceMcpInputSchema>;
