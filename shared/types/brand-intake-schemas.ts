import { z } from 'zod';
import {
  BRAND_INTAKE_BUYING_STAGES,
  BRAND_INTAKE_FIELD_PATHS,
  BRAND_INTAKE_LIMITS,
  BRAND_INTAKE_RESOLUTION_SOURCE_TYPES,
  BRAND_INTAKE_SCHEMA_VERSION,
  BRAND_INTAKE_SOURCES,
} from './brand-intake.js';
import { AUTHENTIC_VOICE_SAMPLE_SOURCES } from './brand-engine.js';
import { AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES } from './generation-evidence.js';

function normalizeEmpty(value: unknown, fallback: unknown): unknown {
  return value == null ? fallback : value;
}

function clearableText(max: number) {
  return z.preprocess(
    value => normalizeEmpty(value, ''),
    z.string().trim().max(max),
  );
}

function normalizedStringList() {
  return z.preprocess(
    value => {
      if (value == null) return [];
      if (!Array.isArray(value)) return value;
      return value
        .map(item => (typeof item === 'string' ? item.trim() : item))
        .filter(item => item !== '');
    },
    z.array(z.string().min(1).max(BRAND_INTAKE_LIMITS.maxListItemLength))
      .max(BRAND_INTAKE_LIMITS.maxListItems)
      .transform(values => [...new Set(values)]),
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

const httpUrlSchema = z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxUrlLength)
  .refine(isHttpUrl, 'must be an absolute HTTP(S) URL');

const clearableHttpUrlSchema = clearableText(BRAND_INTAKE_LIMITS.maxUrlLength)
  .refine(value => value === '' || isHttpUrl(value), 'must be empty or an absolute HTTP(S) URL');

const referenceUrlsSchema = clearableText(
  BRAND_INTAKE_LIMITS.maxUrlLength * BRAND_INTAKE_LIMITS.maxListItems,
).superRefine((value, ctx) => {
  if (value === '') return;
  const urls = value.split(/\r?\n/).map(url => url.trim()).filter(Boolean);
  if (urls.length > BRAND_INTAKE_LIMITS.maxListItems) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      type: 'array',
      maximum: BRAND_INTAKE_LIMITS.maxListItems,
      inclusive: true,
      message: `referenceUrls may contain at most ${BRAND_INTAKE_LIMITS.maxListItems} URLs`,
    });
  }
  urls.forEach((url, index) => {
    if (url.length > BRAND_INTAKE_LIMITS.maxUrlLength || !isHttpUrl(url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: 'each reference URL must be an absolute HTTP(S) URL within the size limit',
      });
    }
  });
});

const businessSchema = z.object({
  businessName: clearableText(BRAND_INTAKE_LIMITS.maxShortTextLength),
  industry: clearableText(BRAND_INTAKE_LIMITS.maxShortTextLength),
  description: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  services: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  locations: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  differentiators: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  website: clearableHttpUrlSchema,
}).strict();

const audienceSchema = z.object({
  primaryAudience: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  painPoints: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  goals: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  objections: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  buyingStage: z.preprocess(
    value => (value == null || value === '' ? 'mixed' : value),
    z.enum(BRAND_INTAKE_BUYING_STAGES),
  ),
  secondaryAudience: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
}).strict();

const voiceSchema = z.object({
  tone: clearableText(BRAND_INTAKE_LIMITS.maxToneLength),
  personality: normalizedStringList(),
  avoidWords: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  contentFormats: normalizedStringList(),
  existingExamples: clearableText(BRAND_INTAKE_LIMITS.maxExampleLength),
}).strict();

const competitorSchema = z.object({
  competitors: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  whatTheyDoBetter: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  whatYouDoBetter: clearableText(BRAND_INTAKE_LIMITS.maxTextLength),
  referenceUrls: referenceUrlsSchema,
}).strict();

function sectionOrEmpty<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return z.preprocess(value => normalizeEmpty(value, {}), schema);
}

export const publicOnboardingQuestionnaireSchema = z.object({
  business: sectionOrEmpty(businessSchema),
  audience: sectionOrEmpty(audienceSchema),
  brand: sectionOrEmpty(voiceSchema),
  competitors: sectionOrEmpty(competitorSchema),
}).strict();

const commonEvidenceSourceFields = {
  sourceId: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength),
  sourceRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  fieldPath: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxShortTextLength).optional(),
  label: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxActorLabelLength).optional(),
  uri: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxUrlLength).optional(),
  capturedAt: z.string().datetime(),
};

const nonVoiceAuthenticSourceTypes = AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES.filter(
  sourceType => sourceType !== 'voice_sample',
) as [
  Exclude<(typeof AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES)[number], 'voice_sample'>,
  ...Exclude<(typeof AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES)[number], 'voice_sample'>[],
];

const authenticSourceRefSchema = z.union([
  z.object({
    sourceType: z.enum(nonVoiceAuthenticSourceTypes),
    ...commonEvidenceSourceFields,
  }).strict(),
  z.object({
    sourceType: z.literal('voice_sample'),
    voiceSampleSource: z.enum(AUTHENTIC_VOICE_SAMPLE_SOURCES),
    ...commonEvidenceSourceFields,
  }).strict(),
]);

export const brandIntakeAuthenticSampleSchema = z.object({
  id: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength),
  kind: z.enum(['client_written', 'approved_existing_copy', 'accepted_source_excerpt']),
  content: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxExampleLength),
  context: z.enum(['headline', 'body', 'cta', 'about', 'service', 'social', 'seo']),
  sourceRef: authenticSourceRefSchema,
}).strict();

export const brandIntakePayloadSchema = publicOnboardingQuestionnaireSchema.extend({
  schemaVersion: z.literal(BRAND_INTAKE_SCHEMA_VERSION),
  authenticSamples: z.array(brandIntakeAuthenticSampleSchema)
    .max(BRAND_INTAKE_LIMITS.maxAuthenticSamples),
}).strict().superRefine((value, ctx) => {
  const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (size > BRAND_INTAKE_LIMITS.maxPayloadBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `normalized brand intake exceeds ${BRAND_INTAKE_LIMITS.maxPayloadBytes} UTF-8 bytes`,
    });
  }
});

export const brandIntakeEvidenceValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxTextLength) }).strict(),
  z.object({ kind: z.literal('text_list'), value: normalizedStringList() }).strict(),
  z.object({ kind: z.literal('url'), value: httpUrlSchema }).strict(),
  z.object({ kind: z.literal('url_list'), value: z.array(httpUrlSchema).min(1).max(BRAND_INTAKE_LIMITS.maxListItems) }).strict(),
  z.object({ kind: z.literal('buying_stage'), value: z.enum(BRAND_INTAKE_BUYING_STAGES) }).strict(),
]);

export const brandIntakeResolutionSourceRefSchema = z.object({
  sourceType: z.enum(BRAND_INTAKE_RESOLUTION_SOURCE_TYPES),
  ...commonEvidenceSourceFields,
}).strict();

export const brandIntakeSubmitterSchema = z.object({
  actorType: z.enum(['client', 'operator', 'mcp', 'system']),
  actorId: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength),
  actorLabel: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxActorLabelLength).optional(),
}).strict();

export const brandIntakeResolverAttributionSchema = z.object({
  actorType: z.enum(['operator', 'client', 'mcp']),
  actorId: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength),
  actorLabel: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxActorLabelLength).optional(),
}).strict();

export const brandIntakeEvidenceResolutionSchema = z.object({
  id: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength),
  requirementId: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength),
  fieldPath: z.enum(BRAND_INTAKE_FIELD_PATHS),
  value: brandIntakeEvidenceValueSchema,
  sourceRef: brandIntakeResolutionSourceRefSchema,
  resolvedBy: brandIntakeResolverAttributionSchema,
  expectedSourceRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expectedArtifactRevisions: z.tuple([]),
  resolvedAt: z.string().datetime(),
}).strict();

export const brandIntakeSourceSchema = z.enum(BRAND_INTAKE_SOURCES);

export type PublicOnboardingQuestionnaireInput = z.input<
  typeof publicOnboardingQuestionnaireSchema
>;
export type NormalizedPublicOnboardingQuestionnaire = z.output<
  typeof publicOnboardingQuestionnaireSchema
>;
