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

/**
 * Strict creation boundary for full-page copy. The provider must return exactly
 * one section for every planned section id; no missing, duplicate, or invented ids.
 * The returned sections are ordered by the authoritative plan, not model order.
 */
export function parseGeneratedPageCopyForPlan(
  rawText: string,
  plannedSectionIds: readonly string[],
): AiGeneratedPageCopy {
  const parsed = parseGeneratedPageCopy(rawText);
  const planned = new Set(plannedSectionIds);
  if (planned.size !== plannedSectionIds.length) {
    throw new Error('The section plan contains duplicate section ids.');
  }

  const generated = new Map<string, AiGeneratedPageCopy['sections'][number]>();
  for (const section of parsed.sections) {
    if (!planned.has(section.sectionPlanItemId)) {
      throw new Error(`Generated copy contains unknown section id: ${section.sectionPlanItemId}`);
    }
    if (generated.has(section.sectionPlanItemId)) {
      throw new Error(`Generated copy contains duplicate section id: ${section.sectionPlanItemId}`);
    }
    generated.set(section.sectionPlanItemId, section);
  }

  const missing = plannedSectionIds.filter(id => !generated.has(id));
  if (missing.length > 0) {
    throw new Error(`Generated copy is missing planned section ids: ${missing.join(', ')}`);
  }

  return {
    ...parsed,
    sections: plannedSectionIds.map(id => generated.get(id)!),
  };
}

export function parseRegeneratedSectionCopy(rawText: string): AiRegeneratedSectionCopy {
  const raw = parseAIJsonRaw(rawText);
  return aiRegeneratedSectionCopySchema.parse(raw);
}
