import { z } from 'zod';

import { VOICE_FINALIZATION_LIMITS } from './voice-finalization.js';

const workspaceIdSchema = z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxIdLength)
  .describe('The workspace whose finalized voice authority is being addressed.');

export const getBrandVoiceInputSchema = z.object({
  workspace_id: workspaceIdSchema,
}).strict();

export const finalizeBrandVoiceMcpInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  authorization_token: z.string().trim().min(1)
    .max(VOICE_FINALIZATION_LIMITS.maxAuthorizationTokenLength)
    .describe('One-time short-lived operator authorization bound to the exact voice profile revision, fields, anchors, ratings, and idempotency key.'),
}).strict();

export type GetBrandVoiceInput = z.infer<typeof getBrandVoiceInputSchema>;
export type FinalizeBrandVoiceMcpInput = z.infer<typeof finalizeBrandVoiceMcpInputSchema>;
