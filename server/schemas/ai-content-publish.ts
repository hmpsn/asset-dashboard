import { z } from '../middleware/validate.js';
import { parseAIJsonRaw } from './_parse-ai-json.js';

export const aiWebflowFieldMappingSchema = z.object({
  title: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  metaTitle: z.string().nullable().optional(),
  metaDescription: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  featuredImage: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  publishDate: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
}).strict();

export type AiWebflowFieldMapping = z.infer<typeof aiWebflowFieldMappingSchema>;

export function parseWebflowFieldMapping(rawText: string): AiWebflowFieldMapping {
  const raw = parseAIJsonRaw(rawText);
  return aiWebflowFieldMappingSchema.parse(raw);
}
