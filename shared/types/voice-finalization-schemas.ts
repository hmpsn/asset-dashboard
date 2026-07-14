import { z } from 'zod';

import {
  AUTHENTIC_VOICE_SAMPLE_SOURCES,
  VOICE_SAMPLE_SOURCES,
} from './brand-engine.js';
import {
  AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES,
} from './generation-evidence.js';
import { VOICE_FINALIZATION_LIMITS } from './voice-finalization.js';

const boundedId = z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxIdLength);
const shortText = z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxShortTextLength);
const contentText = z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxTextLength);
const timestamp = z.string().datetime();
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);

export const generationOperatorAttributionSchema = z.object({
  actorType: z.literal('operator'),
  actorId: boundedId,
  actorLabel: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxActorLabelLength).optional(),
}).strict();

export const generationResolverAttributionSchema = z.object({
  actorType: z.enum(['operator', 'client', 'mcp', 'system']),
  actorId: boundedId,
  actorLabel: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxActorLabelLength).optional(),
}).strict();

export const voiceDNASchema = z.object({
  personalityTraits: z.array(shortText)
    .min(1)
    .max(VOICE_FINALIZATION_LIMITS.maxTraitCount),
  toneSpectrum: z.object({
    formal_casual: z.number().min(1).max(10),
    serious_playful: z.number().min(1).max(10),
    technical_accessible: z.number().min(1).max(10),
  }).strict(),
  sentenceStyle: contentText,
  vocabularyLevel: contentText,
  humorStyle: z.string().trim().max(VOICE_FINALIZATION_LIMITS.maxTextLength).optional(),
}).strict();

const terminologySchema = z.object({
  use: shortText,
  insteadOf: shortText,
}).strict();

export const voiceGuardrailsSchema = z.object({
  forbiddenWords: z.array(shortText).max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup),
  requiredTerminology: z.array(terminologySchema).max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup),
  toneBoundaries: z.array(contentText).max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup),
  antiPatterns: z.array(contentText).max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup),
}).strict().superRefine((value, ctx) => {
  const total = value.forbiddenWords.length
    + value.requiredTerminology.length
    + value.toneBoundaries.length
    + value.antiPatterns.length;
  if (total === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one substantive voice guardrail is required.',
    });
  }
});

export const contextModifierSchema = z.object({
  context: shortText,
  description: contentText,
}).strict();

export const voiceAnchorSelectorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('voice_sample'),
    voiceSampleId: boundedId,
  }).strict(),
  z.object({
    kind: z.literal('brand_intake_sample'),
    intakeRevisionId: boundedId,
    intakeRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sampleId: boundedId,
  }).strict(),
]);

export const voiceCalibrationSelectionSchema = z.object({
  sessionId: boundedId,
  variationIndex: z.number().int().nonnegative().max(1_000),
  rating: z.enum(['on_brand', 'close', 'wrong']),
  selected: z.boolean(),
  feedback: z.string().trim().min(1).max(2_000).optional(),
}).strict();

export const voiceCalibrationSelectionSnapshotSchema = voiceCalibrationSelectionSchema.extend({
  promptType: shortText,
  variationText: contentText,
}).strict();

function selectorIdentity(selector: z.infer<typeof voiceAnchorSelectorSchema>): string {
  return selector.kind === 'voice_sample'
    ? `voice_sample:${selector.voiceSampleId}`
    : `brand_intake_sample:${selector.intakeRevisionId}:${selector.intakeRevision}:${selector.sampleId}`;
}

const voiceProfileFinalizationInputObjectSchema = z.object({
  expectedProfileRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  voiceDNA: voiceDNASchema,
  guardrails: voiceGuardrailsSchema,
  contextModifiers: z.array(contextModifierSchema).max(VOICE_FINALIZATION_LIMITS.maxContextModifiers),
  anchorSelectors: z.array(voiceAnchorSelectorSchema)
    .min(1)
    .max(VOICE_FINALIZATION_LIMITS.maxAnchors),
  calibrationSelections: z.array(voiceCalibrationSelectionSchema)
    .max(VOICE_FINALIZATION_LIMITS.maxCalibrationSelections),
  idempotencyKey: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxIdempotencyKeyLength),
}).strict();

function refineVoiceProfileFinalizationInput(
  value: z.infer<typeof voiceProfileFinalizationInputObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const selectors = new Set<string>();
  value.anchorSelectors.forEach((selector, index) => {
    const identity = selectorIdentity(selector);
    if (selectors.has(identity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchorSelectors', index],
        message: 'Duplicate voice anchor selector.',
      });
    }
    selectors.add(identity);
  });

  const selections = new Set<string>();
  value.calibrationSelections.forEach((selection, index) => {
    const identity = `${selection.sessionId}:${selection.variationIndex}`;
    if (selections.has(identity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['calibrationSelections', index],
        message: 'Duplicate calibration selection.',
      });
    }
    selections.add(identity);
  });
}

export const voiceProfileFinalizationInputSchema =
  voiceProfileFinalizationInputObjectSchema.superRefine(refineVoiceProfileFinalizationInput);

export const finalizeBrandVoiceBodySchema = voiceProfileFinalizationInputSchema;
export const createVoiceFinalizationAuthorizationBodySchema = voiceProfileFinalizationInputSchema;

export const finalizeBrandVoiceRequestSchema = voiceProfileFinalizationInputObjectSchema.extend({
  workspaceId: boundedId,
  finalizedBy: generationOperatorAttributionSchema,
  executionActor: generationResolverAttributionSchema,
  authorizationId: boundedId.optional(),
}).strict().superRefine(refineVoiceProfileFinalizationInput);

export const createVoiceFinalizationAuthorizationRequestSchema = voiceProfileFinalizationInputObjectSchema.extend({
  workspaceId: boundedId,
  authorizedBy: generationOperatorAttributionSchema,
}).strict().superRefine(refineVoiceProfileFinalizationInput);

const authenticVoiceAnchorBaseSchema = z.object({
  sourceId: boundedId,
  sourceRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  fieldPath: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxShortTextLength).optional(),
  label: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxShortTextLength).optional(),
  uri: z.string().trim().min(1).max(2_048).optional(),
  capturedAt: timestamp,
  selectedBy: generationOperatorAttributionSchema,
  selectedAt: timestamp,
});

const nonVoiceSampleSourceTypes = AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES.filter(
  (sourceType): sourceType is Exclude<(typeof AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES)[number], 'voice_sample'> => sourceType !== 'voice_sample',
);

export const authenticVoiceAnchorRefSchema = z.union([
  authenticVoiceAnchorBaseSchema.extend({
    sourceType: z.enum(nonVoiceSampleSourceTypes as [typeof nonVoiceSampleSourceTypes[number], ...typeof nonVoiceSampleSourceTypes]),
  }).strict(),
  authenticVoiceAnchorBaseSchema.extend({
    sourceType: z.literal('voice_sample'),
    voiceSampleSource: z.enum(AUTHENTIC_VOICE_SAMPLE_SOURCES),
  }).strict(),
]);

export const finalizedVoiceSnapshotRefSchema = z.object({
  voiceProfileId: boundedId,
  voiceVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  finalizedBy: generationOperatorAttributionSchema,
  finalizedAt: timestamp,
  fingerprint,
  anchorEvidenceRefs: z.array(authenticVoiceAnchorRefSchema)
    .min(1)
    .max(VOICE_FINALIZATION_LIMITS.maxAnchors),
}).strict();

export const finalizedVoiceAnchorSnapshotSchema = z.object({
  selector: voiceAnchorSelectorSchema,
  content: contentText,
  context: z.enum(['headline', 'body', 'cta', 'about', 'service', 'social', 'seo']),
  evidenceRef: authenticVoiceAnchorRefSchema,
}).strict();

export const finalizedVoiceSnapshotSchema = finalizedVoiceSnapshotRefSchema.extend({
  id: boundedId,
  workspaceId: boundedId,
  profileRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  voiceDNA: voiceDNASchema,
  guardrails: voiceGuardrailsSchema,
  contextModifiers: z.array(contextModifierSchema).max(VOICE_FINALIZATION_LIMITS.maxContextModifiers),
  anchors: z.array(finalizedVoiceAnchorSnapshotSchema)
    .min(1)
    .max(VOICE_FINALIZATION_LIMITS.maxAnchors),
  calibrationSelections: z.array(voiceCalibrationSelectionSnapshotSchema)
    .max(VOICE_FINALIZATION_LIMITS.maxCalibrationSelections),
  executionActor: generationResolverAttributionSchema,
  createdAt: timestamp,
}).strict().superRefine((value, ctx) => {
  if (value.anchors.length !== value.anchorEvidenceRefs.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['anchors'],
      message: 'Frozen anchors must match the evidence-reference census.',
    });
  }
  value.anchors.forEach((anchor, index) => {
    if (JSON.stringify(anchor.evidenceRef) !== JSON.stringify(value.anchorEvidenceRefs[index])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchors', index, 'evidenceRef'],
        message: 'Frozen anchor evidence must match the ordered snapshot reference.',
      });
    }
  });
});

export const voiceFinalizationAuthorizationRefSchema = z.object({
  authorizationId: boundedId,
  workspaceId: boundedId,
  voiceProfileId: boundedId,
  expectedProfileRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  authorizedBy: generationOperatorAttributionSchema,
  issuedAt: timestamp,
  expiresAt: timestamp,
  consumedAt: timestamp.nullable(),
  finalizationId: boundedId.nullable(),
}).strict();

export const authenticVoiceSampleSourceSchema = z.enum(AUTHENTIC_VOICE_SAMPLE_SOURCES);
export const voiceSampleSourceSchema = z.enum(VOICE_SAMPLE_SOURCES);

export type FinalizeBrandVoiceBody = z.infer<typeof finalizeBrandVoiceBodySchema>;
export type CreateVoiceFinalizationAuthorizationBody = z.infer<
  typeof createVoiceFinalizationAuthorizationBodySchema
>;
