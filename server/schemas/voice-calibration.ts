import { z } from '../middleware/validate.js';

export const createVoiceProfileSchema = z.object({}).strict();

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
