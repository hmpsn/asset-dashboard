import { z } from '../middleware/validate.js';
import { parseAIJsonRaw } from './_parse-ai-json.js';

export const aiGeneratedSectionCopySchema = z.object({
  sectionPlanItemId: z.string().trim().min(1),
  copy: z.string().trim().min(1),
  annotation: z.string().trim().min(1),
  reasoning: z.string().trim().min(1),
}).strip();

export const aiGeneratedPageCopySchema = z.object({
  sections: z.array(aiGeneratedSectionCopySchema).min(1),
  seoTitle: z.string().trim().min(1),
  metaDescription: z.string().trim().min(1),
  ogTitle: z.string().trim().min(1),
  ogDescription: z.string().trim().min(1),
}).strip();

export const aiRegeneratedSectionCopySchema = z.object({
  copy: z.string().trim().min(1),
  annotation: z.string().trim().min(1),
  reasoning: z.string().trim().min(1),
}).strip();

export type AiGeneratedPageCopy = z.infer<typeof aiGeneratedPageCopySchema>;
export type AiRegeneratedSectionCopy = z.infer<typeof aiRegeneratedSectionCopySchema>;

export function parseGeneratedPageCopy(rawText: string): AiGeneratedPageCopy {
  const raw = parseAIJsonRaw(rawText);
  return aiGeneratedPageCopySchema.parse(raw);
}

export function parseRegeneratedSectionCopy(rawText: string): AiRegeneratedSectionCopy {
  const raw = parseAIJsonRaw(rawText);
  return aiRegeneratedSectionCopySchema.parse(raw);
}
