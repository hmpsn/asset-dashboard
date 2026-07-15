import { z } from 'zod';

import {
  AUTHENTIC_VOICE_SAMPLE_SOURCES,
  VOICE_SAMPLE_SOURCES,
} from './brand-engine.js';
import {
  AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES,
} from './generation-evidence.js';
import { VOICE_FINALIZATION_LIMITS } from './voice-finalization.js';

const VOICE_FINALIZATION_JSON_BYTE_LIMITS = {
  actor: 4 * 1024,
  voiceDNA: VOICE_FINALIZATION_LIMITS.maxMutableProfileJsonBytes,
  guardrails: VOICE_FINALIZATION_LIMITS.maxMutableProfileJsonBytes,
  contextModifiers: VOICE_FINALIZATION_LIMITS.maxMutableProfileJsonBytes,
  snapshotArray: VOICE_FINALIZATION_LIMITS.maxSnapshotJsonBytes,
  authorizationRequest: VOICE_FINALIZATION_LIMITS.maxAuthorizationJsonBytes,
} as const;

const utf8Encoder = new TextEncoder();

function refineJsonByteLimit(
  value: unknown,
  ctx: z.RefinementCtx,
  label: string,
  limit: number,
): void {
  const size = utf8Encoder.encode(JSON.stringify(value)).byteLength;
  if (size > limit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${label} exceeds ${limit} UTF-8 JSON bytes.`,
    });
  }
}

const boundedId = z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxIdLength);
const shortText = z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxShortTextLength);
const contentText = z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxTextLength);
const timestamp = z.string().datetime();
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);

export const generationOperatorAttributionSchema = z.object({
  actorType: z.literal('operator'),
  actorId: boundedId,
  actorLabel: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxActorLabelLength).optional(),
}).strict().superRefine((value, ctx) => {
  refineJsonByteLimit(
    value,
    ctx,
    'Operator attribution JSON',
    VOICE_FINALIZATION_JSON_BYTE_LIMITS.actor,
  );
});

export const generationResolverAttributionSchema = z.object({
  actorType: z.enum(['operator', 'client', 'mcp', 'system']),
  actorId: boundedId,
  actorLabel: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxActorLabelLength).optional(),
}).strict().superRefine((value, ctx) => {
  refineJsonByteLimit(
    value,
    ctx,
    'Execution actor attribution JSON',
    VOICE_FINALIZATION_JSON_BYTE_LIMITS.actor,
  );
});

export const voiceFinalizationExecutionAttributionSchema = z.object({
  actorType: z.enum(['operator', 'mcp']),
  actorId: boundedId,
  actorLabel: z.string().trim().min(1)
    .max(VOICE_FINALIZATION_LIMITS.maxActorLabelLength)
    .optional(),
}).strict().superRefine((value, ctx) => {
  refineJsonByteLimit(
    value,
    ctx,
    'Voice finalization execution attribution JSON',
    VOICE_FINALIZATION_JSON_BYTE_LIMITS.actor,
  );
});

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
}).strict().superRefine((value, ctx) => {
  refineJsonByteLimit(
    value,
    ctx,
    'Voice DNA JSON',
    VOICE_FINALIZATION_JSON_BYTE_LIMITS.voiceDNA,
  );
});

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
  refineJsonByteLimit(
    value,
    ctx,
    'Voice guardrails JSON',
    VOICE_FINALIZATION_JSON_BYTE_LIMITS.guardrails,
  );
});

export const contextModifierSchema = z.object({
  context: shortText,
  description: contentText,
}).strict();

const contextModifiersSnapshotSchema = z.array(contextModifierSchema)
  .max(VOICE_FINALIZATION_LIMITS.maxContextModifiers)
  .superRefine((value, ctx) => {
    refineJsonByteLimit(
      value,
      ctx,
      'Voice context modifiers JSON',
      VOICE_FINALIZATION_JSON_BYTE_LIMITS.contextModifiers,
    );
  });

// Mutable drafts retain the legacy allowance for empty values while still
// enforcing the exact field/count/byte bounds used by authority reads/writes.
const mutableShortText = z.string().trim()
  .max(VOICE_FINALIZATION_LIMITS.maxShortTextLength);
const mutableContentText = z.string().trim()
  .max(VOICE_FINALIZATION_LIMITS.maxTextLength);

export const boundedMutableVoiceDNASchema = z.object({
  personalityTraits: z.array(mutableShortText)
    .max(VOICE_FINALIZATION_LIMITS.maxTraitCount),
  toneSpectrum: z.object({
    formal_casual: z.number().min(1).max(10),
    serious_playful: z.number().min(1).max(10),
    technical_accessible: z.number().min(1).max(10),
  }).strict(),
  sentenceStyle: mutableContentText,
  vocabularyLevel: mutableContentText,
  humorStyle: mutableContentText.optional(),
}).strict().superRefine((value, ctx) => {
  refineJsonByteLimit(
    value,
    ctx,
    'Mutable voice DNA JSON',
    VOICE_FINALIZATION_JSON_BYTE_LIMITS.voiceDNA,
  );
});

const mutableTerminologySchema = z.object({
  use: mutableShortText,
  insteadOf: mutableShortText,
}).strict();

export const boundedMutableVoiceGuardrailsSchema = z.object({
  forbiddenWords: z.array(mutableShortText)
    .max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup),
  requiredTerminology: z.array(mutableTerminologySchema)
    .max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup),
  toneBoundaries: z.array(mutableContentText)
    .max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup),
  antiPatterns: z.array(mutableContentText)
    .max(VOICE_FINALIZATION_LIMITS.maxGuardrailItemsPerGroup),
}).strict().superRefine((value, ctx) => {
  refineJsonByteLimit(
    value,
    ctx,
    'Mutable voice guardrails JSON',
    VOICE_FINALIZATION_JSON_BYTE_LIMITS.guardrails,
  );
});

export const boundedMutableContextModifiersSchema = z.array(z.object({
  context: mutableShortText,
  description: mutableContentText,
}).strict()).max(VOICE_FINALIZATION_LIMITS.maxContextModifiers)
  .superRefine((value, ctx) => {
    refineJsonByteLimit(
      value,
      ctx,
      'Mutable voice context modifiers JSON',
      VOICE_FINALIZATION_JSON_BYTE_LIMITS.contextModifiers,
    );
  });

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

type ParsedVoiceAnchorSelector = z.infer<typeof voiceAnchorSelectorSchema>;

const nonemptyVoiceAnchorSelectorsSchema = z.array(voiceAnchorSelectorSchema)
  .min(1)
  .max(VOICE_FINALIZATION_LIMITS.maxAnchors)
  .transform((selectors): [ParsedVoiceAnchorSelector, ...ParsedVoiceAnchorSelector[]] => (
    selectors as [ParsedVoiceAnchorSelector, ...ParsedVoiceAnchorSelector[]]
  ));

const voiceProfileFinalizationInputObjectSchema = z.object({
  expectedProfileRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  voiceDNA: voiceDNASchema,
  guardrails: voiceGuardrailsSchema,
  contextModifiers: contextModifiersSnapshotSchema,
  anchorSelectors: nonemptyVoiceAnchorSelectorsSchema,
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

function refineVoiceFinalizationAuthorizationRequest(
  value: z.infer<typeof voiceProfileFinalizationInputObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  refineVoiceProfileFinalizationInput(value, ctx);
  const storedAuthorizationRequest = {
    expectedProfileRevision: value.expectedProfileRevision,
    voiceDNA: value.voiceDNA,
    guardrails: value.guardrails,
    contextModifiers: value.contextModifiers,
    anchorSelectors: value.anchorSelectors,
    calibrationSelections: value.calibrationSelections,
    idempotencyKey: value.idempotencyKey,
  };
  refineJsonByteLimit(
    storedAuthorizationRequest,
    ctx,
    'Voice finalization authorization request JSON',
    VOICE_FINALIZATION_JSON_BYTE_LIMITS.authorizationRequest,
  );
}

/** Frozen structural command codec shared by direct writes and snapshot replay. */
export const voiceProfileFinalizationStructuralInputV1Schema =
  voiceProfileFinalizationInputObjectSchema.superRefine(
    refineVoiceProfileFinalizationInput,
  );

/** Frozen persisted request codec for authorization request_schema_version=1. */
export const voiceProfileFinalizationInputV1Schema =
  voiceProfileFinalizationInputObjectSchema.superRefine(
    refineVoiceFinalizationAuthorizationRequest,
  );

/** Current command codec; advance this alias only when a new frozen version exists. */
export const voiceProfileFinalizationInputSchema = voiceProfileFinalizationInputV1Schema;

export const finalizeBrandVoiceBodySchema = voiceProfileFinalizationStructuralInputV1Schema;
export const createVoiceFinalizationAuthorizationBodySchema = voiceProfileFinalizationInputSchema;

export const finalizeBrandVoiceRequestSchema = voiceProfileFinalizationInputObjectSchema.extend({
  workspaceId: boundedId,
  finalizedBy: generationOperatorAttributionSchema,
  executionActor: voiceFinalizationExecutionAttributionSchema,
  authorizationId: boundedId.optional(),
}).strict().superRefine(refineVoiceProfileFinalizationInput);

export const createVoiceFinalizationAuthorizationRequestSchema = voiceProfileFinalizationInputObjectSchema.extend({
  workspaceId: boundedId,
  authorizedBy: generationOperatorAttributionSchema,
}).strict().superRefine(refineVoiceFinalizationAuthorizationRequest);

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
}).strict().superRefine((value, ctx) => {
  if (value.selector.kind === 'voice_sample') {
    if (
      value.evidenceRef.sourceType !== 'voice_sample'
      || value.evidenceRef.sourceId !== value.selector.voiceSampleId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidenceRef'],
        message: 'Voice-sample evidence must identify the selected voice sample exactly.',
      });
    }
    return;
  }

  if (
    value.evidenceRef.sourceType !== 'brand_intake'
    || value.evidenceRef.sourceId !== value.selector.intakeRevisionId
    || value.evidenceRef.sourceRevision !== value.selector.intakeRevision
    || value.evidenceRef.fieldPath !== `authenticSamples.${value.selector.sampleId}`
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidenceRef'],
      message: 'Brand-intake evidence must identify the selected revision and sample exactly.',
    });
  }
});

export const finalizedVoiceAnchorsSnapshotSchema = z.array(finalizedVoiceAnchorSnapshotSchema)
  .min(1)
  .max(VOICE_FINALIZATION_LIMITS.maxAnchors)
  .superRefine((value, ctx) => {
    refineJsonByteLimit(
      value,
      ctx,
      'Finalized voice anchors JSON',
      VOICE_FINALIZATION_JSON_BYTE_LIMITS.snapshotArray,
    );
  });

export const voiceCalibrationSelectionsSnapshotSchema = z.array(voiceCalibrationSelectionSnapshotSchema)
  .max(VOICE_FINALIZATION_LIMITS.maxCalibrationSelections)
  .superRefine((value, ctx) => {
    refineJsonByteLimit(
      value,
      ctx,
      'Voice calibration selections JSON',
      VOICE_FINALIZATION_JSON_BYTE_LIMITS.snapshotArray,
    );
  });

const finalizedVoiceSnapshotObjectSchema = finalizedVoiceSnapshotRefSchema.extend({
  id: boundedId,
  workspaceId: boundedId,
  profileRevision: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER),
  voiceDNA: voiceDNASchema,
  guardrails: voiceGuardrailsSchema,
  contextModifiers: contextModifiersSnapshotSchema,
  anchors: finalizedVoiceAnchorsSnapshotSchema,
  calibrationSelections: voiceCalibrationSelectionsSnapshotSchema,
  executionActor: voiceFinalizationExecutionAttributionSchema,
  createdAt: timestamp,
}).strict();

function refineFinalizedVoiceSnapshot(
  value: z.infer<typeof finalizedVoiceSnapshotObjectSchema>,
  ctx: z.RefinementCtx,
): void {
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
    if (JSON.stringify(anchor.evidenceRef.selectedBy) !== JSON.stringify(value.finalizedBy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchors', index, 'evidenceRef', 'selectedBy'],
        message: 'Anchor selection attribution must match the finalizing operator.',
      });
    }
    if (anchor.evidenceRef.selectedAt !== value.finalizedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchors', index, 'evidenceRef', 'selectedAt'],
        message: 'Anchor selection time must match the finalization time.',
      });
    }
    if (Date.parse(anchor.evidenceRef.capturedAt) > Date.parse(anchor.evidenceRef.selectedAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchors', index, 'evidenceRef', 'capturedAt'],
        message: 'Anchor evidence cannot be captured after it was selected.',
      });
    }
  });
}

/** Frozen immutable snapshot codec for persisted schema_version=1. */
export const finalizedVoiceSnapshotV1Schema = finalizedVoiceSnapshotObjectSchema
  .superRefine((value, ctx) => {
    refineFinalizedVoiceSnapshot(value, ctx);
    value.anchors.forEach((anchor, index) => {
      if (
        anchor.evidenceRef.sourceType === 'voice_sample'
        && anchor.evidenceRef.voiceSampleSource === 'operator_attested'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['anchors', index, 'evidenceRef', 'voiceSampleSource'],
          message: 'Operator-attested voice samples require snapshot schema version 2.',
        });
      }
    });
  });

/** Frozen immutable snapshot codec for persisted schema_version=2. */
export const finalizedVoiceSnapshotV2Schema = finalizedVoiceSnapshotObjectSchema
  .superRefine(refineFinalizedVoiceSnapshot);

/** Current snapshot codec; advance this alias only when a new frozen version exists. */
export const finalizedVoiceSnapshotSchema = finalizedVoiceSnapshotV2Schema;

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
