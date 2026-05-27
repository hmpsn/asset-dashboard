/**
 * Zod schema for AI-generated schema plan outputs.
 *
 * The schema-plan generator calls `callAI` with `operation: 'schema-plan'` and
 * then bare-`JSON.parse`s the cleaned response, then manually validates with
 * `Array.isArray` guards. This module provides a typed parse wrapper.
 */
import { z } from '../middleware/validate.js';
import { parseAIJsonRaw } from './_parse-ai-json.js';

const schemaPageRoleValues = [
  'homepage', 'pillar', 'service', 'audience', 'lead-gen', 'blog', 'about', 'contact',
  'location', 'product', 'partnership', 'faq', 'case-study', 'comparison', 'howto', 'video',
  'job-posting', 'course', 'event', 'author', 'review', 'pricing', 'recipe', 'generic',
] as const;

const canonicalEntitySchema = z.object({
  type: z.string(),
  name: z.string(),
  canonicalUrl: z.string().optional(),
  id: z.string().optional(),
  description: z.string().optional(),
}).passthrough();

const pageRoleAssignmentSchema = z.object({
  pagePath: z.string(),
  pageTitle: z.string().optional().default(''),
  role: z.enum(schemaPageRoleValues).catch('generic'),
  primaryType: z.string().optional().default('WebPage'),
  entityRefs: z.array(z.string()).optional().default([]),
  notes: z.string().optional(),
  industrySubtype: z.union([z.literal('medical'), z.literal('financial'), z.null()]).catch(null).optional().default(null),
}).passthrough();

/**
 * Schema for the schema-plan AI response.
 * The model returns an object with canonicalEntities and pageRoles arrays.
 */
export const aiSchemaPlanSchema = z.object({
  canonicalEntities: z.array(canonicalEntitySchema),
  pageRoles: z.array(pageRoleAssignmentSchema),
}).passthrough();

export type AiSchemaPlan = z.infer<typeof aiSchemaPlanSchema>;

/**
 * Parse and validate the schema-plan AI response.
 * Throws if the response is missing the required arrays or has malformed JSON.
 */
export function parseSchemaPlan(rawText: string): AiSchemaPlan {
  const raw = parseAIJsonRaw(rawText);
  return aiSchemaPlanSchema.parse(raw);
}
