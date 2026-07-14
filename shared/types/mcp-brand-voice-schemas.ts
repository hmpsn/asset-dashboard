import { z } from 'zod';

import { VOICE_FINALIZATION_LIMITS } from './voice-finalization.js';

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

export const finalizeBrandVoiceMcpInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  authorization_token: z.string().trim().min(1)
    .max(VOICE_FINALIZATION_LIMITS.maxAuthorizationTokenLength)
    .describe('One-time short-lived operator authorization bound to the exact voice profile revision, fields, anchors, ratings, and idempotency key.'),
}).strict();

export type GetBrandVoiceInput = z.infer<typeof getBrandVoiceInputSchema>;
export type FinalizeBrandVoiceMcpInput = z.infer<typeof finalizeBrandVoiceMcpInputSchema>;
