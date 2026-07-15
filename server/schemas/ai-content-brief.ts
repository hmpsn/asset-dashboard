/**
 * Zod schemas for AI-generated content brief outputs.
 *
 * These schemas validate structured AI responses from the content-brief
 * generation and outline-regeneration AI callers. Using typed parse wrappers
 * prevents silent runtime garbage when the model returns an unexpected shape.
 *
 * parseContentBriefOutline — validates the bare-array outline regen response
 * parseContentBriefSchema  — validates the full brief generation/regen response
 */
import { z } from '../middleware/validate.js';
import { parseAIJsonRaw } from './_parse-ai-json.js';

// ── Outline section (mirrors outlineItemSchema) ────────────────────────────

const outlineItemStrictSchema = z.object({
  heading: z.string(),
  subheadings: z.array(z.string()).optional(),
  notes: z.string(),
  wordCount: z.number().optional(),
  keywords: z.array(z.string()).optional(),
}).passthrough(); // AI output often includes extra fields; passthrough matches canonical outlineItemSchema

/**
 * Schema for the outline-regeneration AI caller.
 * The model MUST return a bare JSON array of section objects — NOT an object
 * with an `outline` or `sections` key. The guessed-field-name fallback
 * (outline ?? sections) has been removed; prompt drift must be fixed in
 * the prompt, not masked by a fallback.
 */
export const aiContentBriefOutlineSchema = z.array(outlineItemStrictSchema);

export type AiContentBriefOutline = z.infer<typeof aiContentBriefOutlineSchema>;

/**
 * Parse and validate the outline-regeneration AI response.
 * Throws if the response is not a JSON array matching aiContentBriefOutlineSchema.
 */
export function parseContentBriefOutline(rawText: string): AiContentBriefOutline {
  const raw = parseAIJsonRaw(rawText);
  return aiContentBriefOutlineSchema.parse(raw);
}

// ── Full brief schema (partial — only fields actively read by the callers) ─

/**
 * Schema for the full brief generation and brief-regeneration AI callers.
 * The model returns a JSON object containing all ContentBrief fields.
 * Fields are optional here because the caller applies its own fallbacks
 * (|| existingBrief.X or || []) when merging into the final ContentBrief.
 */
const aiContentBriefFields = {
  secondaryKeywords: z.array(z.string()).optional(),
  suggestedTitle: z.string().optional(),
  suggestedMetaDesc: z.string().optional(),
  outline: z.array(z.object({
    heading: z.string(),
    subheadings: z.array(z.string()).optional(),
    notes: z.string().optional(),
    wordCount: z.number().optional(),
    keywords: z.array(z.string()).optional(),
  }).passthrough()).optional(),
  wordCountTarget: z.number().optional(),
  intent: z.string().optional(),
  audience: z.string().optional(),
  competitorInsights: z.string().optional(),
  internalLinkSuggestions: z.array(z.string()).optional(),
  executiveSummary: z.string().optional(),
  contentFormat: z.string().optional(),
  toneAndStyle: z.string().optional(),
  peopleAlsoAsk: z.array(z.string()).optional(),
  topicalEntities: z.array(z.string()).optional(),
  serpAnalysis: z.object({
    contentType: z.string().optional(),
    avgWordCount: z.number().optional(),
    commonElements: z.array(z.string()).optional(),
    gaps: z.array(z.string()).optional(),
  }).passthrough().optional(),
  difficultyScore: z.number().optional(),
  trafficPotential: z.string().optional(),
  ctaRecommendations: z.array(z.string()).optional(),
  eeatGuidance: z.object({
    experience: z.string().optional(),
    expertise: z.string().optional(),
    authority: z.string().optional(),
    trust: z.string().optional(),
  }).passthrough().optional(),
  contentChecklist: z.array(z.string()).optional(),
  schemaRecommendations: z.array(z.object({
    type: z.string().optional(),
    notes: z.string().optional(),
  }).passthrough()).optional(),
  titleVariants: z.array(z.string()).optional(),
  metaDescVariants: z.array(z.string()).optional(),
};

/** Strict initial-generation contract: every persisted required brief field must be supplied. */
export const aiContentBriefSchema = z.object({
  ...aiContentBriefFields,
  secondaryKeywords: z.array(z.string()),
  suggestedTitle: z.string().trim().min(1),
  suggestedMetaDesc: z.string().trim().min(1),
  outline: z.array(z.object({
    heading: z.string().trim().min(1),
    subheadings: z.array(z.string()).optional(),
    notes: z.string(),
    wordCount: z.number().optional(),
    keywords: z.array(z.string()).optional(),
  }).passthrough()).min(1),
  wordCountTarget: z.number().positive(),
  intent: z.string().trim().min(1),
  audience: z.string().trim().min(1),
  competitorInsights: z.string(),
  internalLinkSuggestions: z.array(z.string()),
}).passthrough();

/** Partial regeneration/update contract; callers merge these fields into an existing valid brief. */
export const aiContentBriefUpdateSchema = z.object(aiContentBriefFields).passthrough();

export type AiContentBrief = z.infer<typeof aiContentBriefSchema>;
export type AiContentBriefUpdate = z.infer<typeof aiContentBriefUpdateSchema>;

/**
 * Parse and validate the full brief generation/regeneration AI response.
 * Throws if the response is not a JSON object matching aiContentBriefSchema.
 */
export function parseContentBriefSchema(rawText: string): AiContentBrief {
  const raw = parseAIJsonRaw(rawText);
  return aiContentBriefSchema.parse(raw);
}

export function parseContentBriefUpdate(rawText: string): AiContentBriefUpdate {
  const raw = parseAIJsonRaw(rawText);
  return aiContentBriefUpdateSchema.parse(raw);
}
