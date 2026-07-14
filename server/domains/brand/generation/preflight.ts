import {
  BRAND_INTAKE_FIELD_PATHS,
  type BrandIntakeFieldEvidence,
  type BrandIntakeFieldPath,
  type BrandIntakePayload,
  type BrandIntakeRevision,
} from '../../../../shared/types/brand-intake.js';
import type {
  ApprovedBrandDeliverableRef,
  BrandGenerationAtomicTarget,
  BrandGenerationBudgetEstimate,
  BrandGenerationPreflightAttemptOutput,
  BrandGenerationTargetInputSnapshot,
} from '../../../../shared/types/brand-generation.js';
import type {
  GenerationEvidenceRequirement,
  GenerationEvidenceSourceRef,
  GenerationFactualEvidenceSourceRef,
  GenerationPlaceholderProjection,
} from '../../../../shared/types/generation-evidence.js';
import type { FinalizedVoiceSnapshot } from '../../../../shared/types/voice-finalization.js';
import { materializeBrandIntakePayload } from '../intake/projection.js';

export interface FrozenApprovedBrandDeliverable {
  ref: ApprovedBrandDeliverableRef;
  content: string;
}

/** Complete immutable input supplied by the worker. This module performs no authority reads. */
export interface BrandGenerationFrozenTargetInput {
  workspaceId: string;
  inputSnapshot: BrandGenerationTargetInputSnapshot;
  intakeRevision: BrandIntakeRevision;
  fieldEvidence: readonly BrandIntakeFieldEvidence[];
  finalizedVoice: FinalizedVoiceSnapshot | null;
  approvedDeliverables: readonly FrozenApprovedBrandDeliverable[];
}

export interface BrandGenerationEvidenceCatalogEntry {
  key: string;
  kind: 'intake_field' | 'authentic_sample' | 'finalized_voice' | 'approved_deliverable';
  fieldPath?: string;
  value: string | string[];
  sourceRefs: GenerationEvidenceSourceRef[];
  /** Authentic style and generated identity inputs never prove a business fact. */
  supportsFactualClaims: boolean;
}

export interface BrandGenerationPreflightResult {
  attemptOutput: BrandGenerationPreflightAttemptOutput;
  evidenceCatalog: readonly BrandGenerationEvidenceCatalogEntry[];
  materializedPayload: BrandIntakePayload;
}

export class BrandGenerationPreflightContractError extends Error {
  readonly code = 'brand_generation_preflight_contract';

  constructor(message: string) {
    super(message);
    this.name = 'BrandGenerationPreflightContractError';
  }
}

interface FieldRequirementPolicy {
  fieldPath: BrandIntakeFieldPath;
  requirementStage: 'preflight' | 'ready' | 'optional_omit';
  claim: string;
  reason: string;
  prompt: string;
}

const BASE_BOOTSTRAP_FIELDS: readonly FieldRequirementPolicy[] = [
  {
    fieldPath: 'business.businessName',
    requirementStage: 'preflight',
    claim: 'The business has an accepted name.',
    reason: 'A voice foundation must remain tied to a named intake source.',
    prompt: 'Provide the business name.',
  },
  {
    fieldPath: 'brand.tone',
    requirementStage: 'ready',
    claim: 'The client supplied a preferred tone.',
    reason: 'A missing tone preference must stay visible in the provisional foundation.',
    prompt: 'Describe the tone the brand should use.',
  },
  {
    fieldPath: 'brand.personality',
    requirementStage: 'ready',
    claim: 'The client supplied brand personality traits.',
    reason: 'A missing personality preference must stay visible in the provisional foundation.',
    prompt: 'Provide the brand personality traits.',
  },
];

const BASE_DURABLE_FIELDS: readonly FieldRequirementPolicy[] = [
  {
    fieldPath: 'business.businessName',
    requirementStage: 'preflight',
    claim: 'The business has an accepted name.',
    reason: 'Dependent brand work must remain tied to a named intake source.',
    prompt: 'Provide the business name.',
  },
  {
    fieldPath: 'business.description',
    requirementStage: 'preflight',
    claim: 'The intake describes what the business does.',
    reason: 'Dependent brand work cannot be grounded without an accepted business description.',
    prompt: 'Describe what the business does.',
  },
  {
    fieldPath: 'business.services',
    requirementStage: 'ready',
    claim: 'The intake identifies the offered services or products.',
    reason: 'Unsupported service detail must remain a typed placeholder.',
    prompt: 'List the services or products this deliverable may reference.',
  },
  {
    fieldPath: 'business.differentiators',
    requirementStage: 'ready',
    claim: 'The intake identifies accepted differentiators.',
    reason: 'The generator may not invent positioning proof.',
    prompt: 'Provide the verified differentiators this deliverable may use.',
  },
  {
    fieldPath: 'audience.primaryAudience',
    requirementStage: 'ready',
    claim: 'The intake identifies the primary audience.',
    reason: 'The generator may not invent a customer segment.',
    prompt: 'Describe the primary audience.',
  },
];

const AUDIENCE_TARGETS = new Set<BrandGenerationAtomicTarget>([
  'personas',
  'customer_journey',
  'objection_handling',
  'emotional_triggers',
]);

function targetFieldPolicies(target: BrandGenerationAtomicTarget): FieldRequirementPolicy[] {
  if (target === 'voice_foundation') return [...BASE_BOOTSTRAP_FIELDS];
  const policies = BASE_DURABLE_FIELDS.map(policy => ({ ...policy }));
  if (AUDIENCE_TARGETS.has(target)) {
    const audience = policies.find(policy => policy.fieldPath === 'audience.primaryAudience');
    if (audience) audience.requirementStage = 'preflight';
    policies.push(
      {
        fieldPath: 'audience.painPoints',
        requirementStage: 'ready',
        claim: 'The intake identifies audience pain points.',
        reason: 'Audience pain points cannot be invented.',
        prompt: 'Provide the audience pain points this deliverable may use.',
      },
      {
        fieldPath: 'audience.goals',
        requirementStage: 'ready',
        claim: 'The intake identifies audience goals.',
        reason: 'Audience goals cannot be invented.',
        prompt: 'Provide the audience goals this deliverable may use.',
      },
    );
  }
  if (target === 'naming') {
    policies.push({
      fieldPath: 'business.industry',
      requirementStage: 'ready',
      claim: 'The intake identifies the business industry.',
      reason: 'A name proposal should not imply an unknown category.',
      prompt: 'Provide the industry or category for the naming proposal.',
    });
  }
  return policies;
}

function fieldValue(payload: BrandIntakePayload, fieldPath: BrandIntakeFieldPath): string | string[] {
  switch (fieldPath) {
    case 'business.businessName': return payload.business.businessName;
    case 'business.industry': return payload.business.industry;
    case 'business.description': return payload.business.description;
    case 'business.services': return payload.business.services;
    case 'business.locations': return payload.business.locations;
    case 'business.differentiators': return payload.business.differentiators;
    case 'business.website': return payload.business.website;
    case 'audience.primaryAudience': return payload.audience.primaryAudience;
    case 'audience.painPoints': return payload.audience.painPoints;
    case 'audience.goals': return payload.audience.goals;
    case 'audience.objections': return payload.audience.objections;
    case 'audience.buyingStage': return payload.audience.buyingStage;
    case 'audience.secondaryAudience': return payload.audience.secondaryAudience;
    case 'brand.tone': return payload.brand.tone;
    case 'brand.personality': return payload.brand.personality;
    case 'brand.avoidWords': return payload.brand.avoidWords;
    case 'brand.contentFormats': return payload.brand.contentFormats;
    case 'brand.existingExamples': return payload.brand.existingExamples;
    case 'competitors.competitors': return payload.competitors.competitors;
    case 'competitors.whatTheyDoBetter': return payload.competitors.whatTheyDoBetter;
    case 'competitors.whatYouDoBetter': return payload.competitors.whatYouDoBetter;
    case 'competitors.referenceUrls': return payload.competitors.referenceUrls;
  }
}

function valuePresent(value: string | string[]): boolean {
  return Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
}

function sourceIdentity(source: GenerationEvidenceSourceRef): string {
  return JSON.stringify({
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceRevision: source.sourceRevision,
    fieldPath: source.fieldPath,
    label: source.label,
    uri: source.uri,
    capturedAt: source.capturedAt,
    ...('voiceSampleSource' in source ? { voiceSampleSource: source.voiceSampleSource } : {}),
  });
}

function assertExactFieldEvidence(
  revision: BrandIntakeRevision,
  materializedPayload: BrandIntakePayload,
  fieldEvidence: readonly BrandIntakeFieldEvidence[],
): Map<BrandIntakeFieldPath, BrandIntakeFieldEvidence> {
  if (fieldEvidence.length !== BRAND_INTAKE_FIELD_PATHS.length) {
    throw new BrandGenerationPreflightContractError('Field evidence must contain the exact intake field census.');
  }
  const byField = new Map<BrandIntakeFieldPath, BrandIntakeFieldEvidence>();
  for (const item of fieldEvidence) {
    if (byField.has(item.fieldPath) || item.requirementId !== `brand-intake:${item.fieldPath}`) {
      throw new BrandGenerationPreflightContractError('Field evidence contains a duplicate or mismatched requirement identity.');
    }
    const present = valuePresent(fieldValue(materializedPayload, item.fieldPath));
    if (item.availability === 'missing') {
      if (present || item.sourceRefs.length !== 0 || item.resolution !== null) {
        throw new BrandGenerationPreflightContractError('Missing field evidence does not match the exact intake revision.');
      }
    } else if (item.availability === 'submitted') {
      const source = item.sourceRefs[0];
      if (
        !present
        || item.sourceRefs.length !== 1
        || item.resolution !== null
        || !source
        || source.sourceType !== 'brand_intake'
        || source.sourceId !== revision.id
        || source.sourceRevision !== revision.revision
        || source.fieldPath !== item.fieldPath
        || source.capturedAt !== revision.createdAt
      ) {
        throw new BrandGenerationPreflightContractError('Submitted field evidence is not from the exact intake revision.');
      }
    } else {
      const resolution = item.resolution;
      if (
        !present
        || !resolution
        || resolution.fieldPath !== item.fieldPath
        || resolution.requirementId !== item.requirementId
        || item.sourceRefs.length !== 1
        || sourceIdentity(item.sourceRefs[0]) !== sourceIdentity(resolution.sourceRef)
      ) {
        throw new BrandGenerationPreflightContractError('Resolved field evidence is not from the exact intake revision.');
      }
    }
    byField.set(item.fieldPath, item);
  }
  return byField;
}

function assertFrozenEnvelope(input: BrandGenerationFrozenTargetInput): void {
  const { inputSnapshot, intakeRevision } = input;
  if (
    input.workspaceId !== intakeRevision.workspaceId
    || inputSnapshot.intakeRevision.intakeRevisionId !== intakeRevision.id
    || inputSnapshot.intakeRevision.revision !== intakeRevision.revision
    || inputSnapshot.intakeRevision.fingerprint !== intakeRevision.fingerprint
  ) {
    throw new BrandGenerationPreflightContractError('Frozen input does not reference the exact intake revision.');
  }
  if (inputSnapshot.target === 'voice_foundation') {
    if (inputSnapshot.artifactExpectation !== null || inputSnapshot.voiceSnapshot !== null || input.finalizedVoice !== null) {
      throw new BrandGenerationPreflightContractError('Voice foundation input cannot contain a durable artifact or voice authority.');
    }
  } else if (inputSnapshot.artifactExpectation === null) {
    throw new BrandGenerationPreflightContractError('Durable target input requires an artifact write expectation.');
  }

  if (inputSnapshot.voiceSnapshot) {
    const voice = input.finalizedVoice;
    if (
      !voice
      || voice.workspaceId !== input.workspaceId
      || voice.voiceProfileId !== inputSnapshot.voiceSnapshot.voiceProfileId
      || voice.voiceVersion !== inputSnapshot.voiceSnapshot.voiceVersion
      || voice.fingerprint !== inputSnapshot.voiceSnapshot.fingerprint
    ) {
      throw new BrandGenerationPreflightContractError('Finalized voice does not match the frozen exact authority reference.');
    }
  } else if (input.finalizedVoice) {
    throw new BrandGenerationPreflightContractError('Frozen input omitted the supplied finalized voice authority.');
  }

  const expectedRefs = new Map(inputSnapshot.approvedDeliverables.map(ref => [ref.deliverableId, ref]));
  if (expectedRefs.size !== input.approvedDeliverables.length) {
    throw new BrandGenerationPreflightContractError('Frozen approved deliverables do not match the input snapshot.');
  }
  for (const deliverable of input.approvedDeliverables) {
    const expected = expectedRefs.get(deliverable.ref.deliverableId);
    if (!expected || JSON.stringify(expected) !== JSON.stringify(deliverable.ref) || !deliverable.content.trim()) {
      throw new BrandGenerationPreflightContractError('Frozen approved deliverables do not match the input snapshot.');
    }
  }
}

function fieldRequirement(
  policy: FieldRequirementPolicy,
  evidence: BrandIntakeFieldEvidence,
): GenerationEvidenceRequirement {
  const common = {
    id: evidence.requirementId,
    fieldPath: evidence.fieldPath,
    claim: policy.claim,
    reason: policy.reason,
    requirementStage: policy.requirementStage,
    clientSafePrompt: policy.prompt,
    claimKind: 'factual' as const,
  };
  return evidence.availability === 'missing'
    ? { ...common, status: 'missing', sourceRefs: [] }
    : {
        ...common,
        status: 'verified',
        sourceRefs: evidence.sourceRefs as [
          GenerationFactualEvidenceSourceRef,
          ...GenerationFactualEvidenceSourceRef[],
        ],
      };
}

function placeholderFor(requirement: GenerationEvidenceRequirement): GenerationPlaceholderProjection | null {
  if (requirement.status !== 'missing' || requirement.requirementStage !== 'ready') return null;
  const prompt = (requirement.clientSafePrompt ?? requirement.claim)
    .replace(/\]/g, '')
    .trim()
    .slice(0, 180);
  return {
    requirementId: requirement.id,
    token: `[NEEDS CLIENT INPUT: ${prompt}]`,
    prompt,
  };
}

function buildCatalog(
  input: BrandGenerationFrozenTargetInput,
  payload: BrandIntakePayload,
  byField: Map<BrandIntakeFieldPath, BrandIntakeFieldEvidence>,
): BrandGenerationEvidenceCatalogEntry[] {
  const catalog: BrandGenerationEvidenceCatalogEntry[] = [];
  for (const fieldPath of BRAND_INTAKE_FIELD_PATHS) {
    const evidence = byField.get(fieldPath)!;
    const value = fieldValue(payload, fieldPath);
    if (evidence.availability === 'missing') continue;
    catalog.push({
      key: evidence.requirementId,
      kind: 'intake_field',
      fieldPath,
      value,
      sourceRefs: evidence.sourceRefs,
      supportsFactualClaims: true,
    });
  }
  for (const sample of payload.authenticSamples) {
    catalog.push({
      key: `authentic-sample:${sample.id}`,
      kind: 'authentic_sample',
      fieldPath: `authenticSamples.${sample.id}`,
      value: sample.content,
      sourceRefs: [sample.sourceRef],
      supportsFactualClaims: false,
    });
  }
  if (input.finalizedVoice) {
    catalog.push({
      key: `finalized-voice:${input.finalizedVoice.voiceVersion}`,
      kind: 'finalized_voice',
      value: input.finalizedVoice.fingerprint,
      sourceRefs: [{
        sourceType: 'voice_profile',
        sourceId: input.finalizedVoice.voiceProfileId,
        sourceRevision: input.finalizedVoice.profileRevision,
        capturedAt: input.finalizedVoice.finalizedAt,
      }],
      supportsFactualClaims: false,
    });
  }
  for (const deliverable of input.approvedDeliverables) {
    catalog.push({
      key: `approved-deliverable:${deliverable.ref.deliverableType}:${deliverable.ref.deliverableId}:${deliverable.ref.version}`,
      kind: 'approved_deliverable',
      value: deliverable.content,
      sourceRefs: [{
        sourceType: 'brand_deliverable',
        sourceId: deliverable.ref.deliverableId,
        sourceRevision: deliverable.ref.version,
        capturedAt: deliverable.ref.approvedAt,
      }],
      supportsFactualClaims: false,
    });
  }
  return catalog;
}

function voiceRequirement(input: BrandGenerationFrozenTargetInput): GenerationEvidenceRequirement {
  if (!input.finalizedVoice) {
    return {
      id: 'brand-voice:finalized',
      fieldPath: 'voice.finalizedVersion',
      claim: 'A finalized immutable voice authority exists.',
      reason: 'Dependent brand generation cannot use provisional or mutable voice.',
      requirementStage: 'preflight',
      clientSafePrompt: 'Finalize the brand voice before generating dependent deliverables.',
      claimKind: 'structural',
      status: 'missing',
      sourceRefs: [],
    };
  }
  return {
    id: 'brand-voice:finalized',
    fieldPath: 'voice.finalizedVersion',
    claim: 'A finalized immutable voice authority exists.',
    reason: 'Dependent brand generation must use this exact frozen voice.',
    requirementStage: 'preflight',
    claimKind: 'structural',
    status: 'verified',
    sourceRefs: [{
      sourceType: 'voice_profile',
      sourceId: input.finalizedVoice.voiceProfileId,
      sourceRevision: input.finalizedVoice.profileRevision,
      capturedAt: input.finalizedVoice.finalizedAt,
    }],
  };
}

function authenticSampleRequirement(payload: BrandIntakePayload): GenerationEvidenceRequirement {
  const common = {
    id: 'brand-intake:authenticSamples',
    fieldPath: 'authenticSamples',
    claim: 'At least one accepted authentic voice sample is available.',
    reason: 'A provisional voice may be drafted without a sample, but the missing authentic anchor must remain visible.',
    requirementStage: 'ready' as const,
    clientSafePrompt: 'Provide at least one authentic brand voice sample.',
    claimKind: 'structural' as const,
  };
  return payload.authenticSamples.length === 0
    ? { ...common, status: 'missing', sourceRefs: [] }
    : {
        ...common,
        status: 'verified',
        sourceRefs: payload.authenticSamples.map(sample => sample.sourceRef) as [
          GenerationEvidenceSourceRef,
          ...GenerationEvidenceSourceRef[],
        ],
      };
}

function estimateForOneTarget(): BrandGenerationBudgetEstimate {
  return {
    providerCalls: 6,
    inputTokens: 50_000,
    outputTokens: 13_000,
    estimatedCostMicros: 4_500_000,
    maxConcurrency: 1,
  };
}

export function runBrandGenerationPreflight(
  input: BrandGenerationFrozenTargetInput,
): BrandGenerationPreflightResult {
  assertFrozenEnvelope(input);
  const materializedPayload = materializeBrandIntakePayload(input.intakeRevision);
  const byField = assertExactFieldEvidence(input.intakeRevision, materializedPayload, input.fieldEvidence);
  const requirements = targetFieldPolicies(input.inputSnapshot.target)
    .map(policy => fieldRequirement(policy, byField.get(policy.fieldPath)!));
  if (input.inputSnapshot.target === 'voice_foundation') {
    requirements.push(authenticSampleRequirement(materializedPayload));
  } else {
    requirements.push(voiceRequirement(input));
  }
  const requirementIds = new Set(requirements.map(requirement => requirement.id));
  if (
    new Set(input.inputSnapshot.evidenceRequirementIds).size !== input.inputSnapshot.evidenceRequirementIds.length
    || input.inputSnapshot.evidenceRequirementIds.some(id => !requirementIds.has(id))
  ) {
    throw new BrandGenerationPreflightContractError('Frozen input contains an invalid evidence-requirement identity.');
  }

  const placeholders = requirements
    .map(placeholderFor)
    .filter((placeholder): placeholder is GenerationPlaceholderProjection => placeholder !== null);
  const blockingRequirementIds = requirements
    .filter(requirement => (
      requirement.requirementStage === 'preflight'
      && requirement.status !== 'verified'
    ))
    .map(requirement => requirement.id);
  return {
    attemptOutput: {
      kind: 'preflight',
      readyForPaidWork: blockingRequirementIds.length === 0,
      blockingRequirementIds,
      requirements,
      placeholders,
      estimate: estimateForOneTarget(),
    },
    evidenceCatalog: buildCatalog(input, materializedPayload, byField),
    materializedPayload,
  };
}
