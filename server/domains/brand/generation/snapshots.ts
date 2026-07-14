import type {
  BrandDeliverable,
} from '../../../../shared/types/brand-engine.js';
import type {
  ApprovedBrandDeliverableRef,
  BrandGenerationAtomicTarget,
  BrandGenerationTargetInputSnapshot,
  FinalizedVoiceSnapshotRef,
} from '../../../../shared/types/brand-generation.js';
import type {
  BrandIntakeFieldEvidence,
  BrandIntakeRevision,
} from '../../../../shared/types/brand-intake.js';
import type { FinalizedVoiceSnapshot } from '../../../../shared/types/voice-finalization.js';
import { getDeliverable, listDeliverables } from '../../../brand-identity.js';
import {
  getBrandIntakeRevision,
} from '../intake/service.js';
import {
  getFinalizedVoiceSnapshotForGeneration,
} from '../voice-finalization.js';
import { BrandGenerationPreconditionError } from './errors.js';
import {
  brandGenerationApprovalFingerprint,
  brandGenerationSnapshotFingerprint,
  canonicalBrandGenerationFingerprint,
} from './fingerprint.js';
import {
  BrandGenerationPreflightContractError,
  runBrandGenerationPreflight,
  type BrandGenerationFrozenTargetInput,
  type BrandGenerationPreflightResult,
  type FrozenApprovedBrandDeliverable,
} from './preflight.js';

export interface BrandGenerationSnapshotDependencies {
  getBrandIntakeRevision: typeof getBrandIntakeRevision;
  getFinalizedVoiceSnapshotForGeneration: typeof getFinalizedVoiceSnapshotForGeneration;
  listDeliverables: typeof listDeliverables;
  getDeliverable: typeof getDeliverable;
}

const DEFAULT_DEPENDENCIES: BrandGenerationSnapshotDependencies = {
  getBrandIntakeRevision,
  getFinalizedVoiceSnapshotForGeneration,
  listDeliverables,
  getDeliverable,
};

export interface CurrentBrandIntakeAuthority {
  revision: BrandIntakeRevision;
  fieldEvidence: BrandIntakeFieldEvidence[];
}

export interface PrepareBrandGenerationSnapshotsInput {
  workspaceId: string;
  intake: CurrentBrandIntakeAuthority;
  targets: readonly BrandGenerationAtomicTarget[];
  finalizedVoice: FinalizedVoiceSnapshot | null;
  capturedAt: string;
  deliverables?: BrandDeliverable[];
}

function dependencies(
  overrides?: Partial<BrandGenerationSnapshotDependencies>,
): BrandGenerationSnapshotDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function exactIntakeRef(revision: BrandIntakeRevision) {
  return {
    intakeRevisionId: revision.id,
    revision: revision.revision,
    fingerprint: revision.fingerprint,
  };
}

function exactVoiceRef(snapshot: FinalizedVoiceSnapshot): FinalizedVoiceSnapshotRef {
  return {
    voiceProfileId: snapshot.voiceProfileId,
    voiceVersion: snapshot.voiceVersion,
    finalizedBy: snapshot.finalizedBy,
    finalizedAt: snapshot.finalizedAt,
    fingerprint: snapshot.fingerprint,
    anchorEvidenceRefs: snapshot.anchorEvidenceRefs,
  };
}

function approvedRef(deliverable: BrandDeliverable): ApprovedBrandDeliverableRef {
  const contentFingerprint = canonicalBrandGenerationFingerprint(deliverable.content);
  const approvedAt = deliverable.updatedAt;
  const ref = {
    deliverableId: deliverable.id,
    deliverableType: deliverable.deliverableType,
    version: deliverable.version,
    approvedAt,
    contentFingerprint,
  };
  return {
    ...ref,
    approvalFingerprint: brandGenerationApprovalFingerprint(ref),
  };
}

function approvedContext(
  target: BrandGenerationAtomicTarget,
  deliverables: readonly BrandDeliverable[],
): FrozenApprovedBrandDeliverable[] {
  if (target === 'voice_foundation') return [];
  return deliverables
    .filter(deliverable => deliverable.status === 'approved')
    .map(deliverable => ({ ref: approvedRef(deliverable), content: deliverable.content }))
    .sort((left, right) => (
      left.ref.deliverableType.localeCompare(right.ref.deliverableType)
      || left.ref.deliverableId.localeCompare(right.ref.deliverableId)
    ));
}

function artifactExpectation(
  target: BrandGenerationAtomicTarget,
  deliverables: readonly BrandDeliverable[],
): BrandGenerationTargetInputSnapshot['artifactExpectation'] {
  if (target === 'voice_foundation') return null;
  const existing = deliverables.find(deliverable => deliverable.deliverableType === target);
  if (!existing) {
    return { kind: 'create', deliverableId: null, expectedVersion: 0 };
  }
  if (existing.status === 'approved') {
    throw new BrandGenerationPreconditionError(
      'approved_deliverable',
      'Approved brand deliverables must be returned to draft before generation.',
    );
  }
  return {
    kind: 'update',
    deliverableId: existing.id,
    expectedVersion: existing.version,
  };
}

function snapshotWithFingerprint(
  value: Omit<BrandGenerationTargetInputSnapshot, 'fingerprint'>,
): BrandGenerationTargetInputSnapshot {
  return {
    ...value,
    fingerprint: brandGenerationSnapshotFingerprint(value),
  };
}

function assertExactRequirementCensus(
  snapshot: BrandGenerationTargetInputSnapshot,
  preflight: BrandGenerationPreflightResult,
): void {
  const expected = preflight.attemptOutput.requirements.map(requirement => requirement.id);
  if (
    expected.length !== snapshot.evidenceRequirementIds.length
    || expected.some((id, index) => snapshot.evidenceRequirementIds[index] !== id)
  ) {
    throw new BrandGenerationPreflightContractError(
      'Frozen input does not contain the exact ordered evidence-requirement census.',
    );
  }
}

function prepareOneSnapshot(
  input: PrepareBrandGenerationSnapshotsInput,
  target: BrandGenerationAtomicTarget,
  deliverables: readonly BrandDeliverable[],
): BrandGenerationFrozenTargetInput {
  const approvedDeliverables = approvedContext(target, deliverables);
  const common = {
    schemaVersion: 1 as const,
    target,
    intakeRevision: exactIntakeRef(input.intake.revision),
    voiceSnapshot: input.finalizedVoice ? exactVoiceRef(input.finalizedVoice) : null,
    approvedDeliverables: approvedDeliverables.map(item => item.ref),
    artifactExpectation: artifactExpectation(target, deliverables),
    capturedAt: input.capturedAt,
  };
  const provisionalSnapshot = snapshotWithFingerprint({
    ...common,
    evidenceRequirementIds: [],
  });
  const provisionalInput: BrandGenerationFrozenTargetInput = {
    workspaceId: input.workspaceId,
    inputSnapshot: provisionalSnapshot,
    intakeRevision: input.intake.revision,
    fieldEvidence: input.intake.fieldEvidence,
    finalizedVoice: input.finalizedVoice,
    approvedDeliverables,
  };
  const requirementIds = runBrandGenerationPreflight(provisionalInput)
    .attemptOutput.requirements.map(requirement => requirement.id);
  const inputSnapshot = snapshotWithFingerprint({
    ...common,
    evidenceRequirementIds: requirementIds,
  });
  const frozenInput = { ...provisionalInput, inputSnapshot };
  // Re-run against the final snapshot so a malformed requirement census cannot
  // cross the durable boundary even if a future target policy changes.
  assertExactRequirementCensus(inputSnapshot, runBrandGenerationPreflight(frozenInput));
  return frozenInput;
}

export function readCurrentBrandIntakeAuthority(
  workspaceId: string,
  expected: {
    intakeRevisionId: string;
    expectedIntakeRevision: number;
    expectedIntakeFingerprint: string;
  },
  overrides?: Partial<BrandGenerationSnapshotDependencies>,
): CurrentBrandIntakeAuthority {
  const read = dependencies(overrides).getBrandIntakeRevision({ workspaceId });
  const revision = read.revision;
  if (!revision) {
    throw new BrandGenerationPreconditionError(
      'intake_changed',
      'A current immutable brand intake is required before generation.',
    );
  }
  if (
    revision.id !== expected.intakeRevisionId
    || revision.revision !== expected.expectedIntakeRevision
    || revision.fingerprint !== expected.expectedIntakeFingerprint
  ) {
    throw new BrandGenerationPreconditionError(
      'intake_changed',
      'The brand intake changed. Re-read the current revision before retrying.',
    );
  }
  return { revision, fieldEvidence: read.fieldEvidence };
}

export function prepareBrandGenerationSnapshots(
  input: PrepareBrandGenerationSnapshotsInput,
  overrides?: Partial<BrandGenerationSnapshotDependencies>,
): BrandGenerationFrozenTargetInput[] {
  const deliverables = input.deliverables
    ?? dependencies(overrides).listDeliverables(input.workspaceId);
  const uniqueTargets = new Set(input.targets);
  if (uniqueTargets.size !== input.targets.length || input.targets.length === 0) {
    throw new BrandGenerationPreconditionError(
      'invalid_selection',
      'Brand generation requires a non-empty selection with no duplicate targets.',
    );
  }
  return input.targets.map(target => prepareOneSnapshot(input, target, deliverables));
}

function contentAtApprovedVersion(
  workspaceId: string,
  ref: ApprovedBrandDeliverableRef,
  deps: BrandGenerationSnapshotDependencies,
): string {
  const deliverable = deps.getDeliverable(workspaceId, ref.deliverableId);
  if (!deliverable || deliverable.deliverableType !== ref.deliverableType) {
    throw new BrandGenerationPreconditionError(
      'invalid_lifecycle',
      'A frozen approved brand input is no longer available.',
    );
  }
  const content = deliverable.version === ref.version
    ? deliverable.content
    : deliverable.versions.find(version => version.version === ref.version)?.content;
  if (!content || canonicalBrandGenerationFingerprint(content) !== ref.contentFingerprint) {
    throw new BrandGenerationPreconditionError(
      'invalid_lifecycle',
      'A frozen approved brand input no longer matches its accepted version.',
    );
  }
  return content;
}

function assertSnapshotFingerprintIntegrity(
  inputSnapshot: BrandGenerationTargetInputSnapshot,
): void {
  const { fingerprint, ...immutableSnapshot } = inputSnapshot;
  if (brandGenerationSnapshotFingerprint(immutableSnapshot) !== fingerprint) {
    throw new BrandGenerationPreconditionError(
      'invalid_lifecycle',
      'The frozen brand-generation input no longer matches its immutable snapshot fingerprint.',
    );
  }

  for (const ref of inputSnapshot.approvedDeliverables) {
    const { approvalFingerprint, ...approval } = ref;
    if (
      brandGenerationApprovalFingerprint(approval)
      !== approvalFingerprint
    ) {
      throw new BrandGenerationPreconditionError(
        'invalid_lifecycle',
        'A frozen approved brand input no longer matches its approval fingerprint.',
      );
    }
  }
}

/** Rehydrate only the exact durable authority captured before paid dispatch. */
export function hydrateBrandGenerationSnapshot(
  workspaceId: string,
  inputSnapshot: BrandGenerationTargetInputSnapshot,
  overrides?: Partial<BrandGenerationSnapshotDependencies>,
): BrandGenerationFrozenTargetInput {
  assertSnapshotFingerprintIntegrity(inputSnapshot);
  const deps = dependencies(overrides);
  const intake = deps.getBrandIntakeRevision({
    workspaceId,
    intakeRevisionId: inputSnapshot.intakeRevision.intakeRevisionId,
  });
  if (
    !intake.revision
    || intake.revision.revision !== inputSnapshot.intakeRevision.revision
    || intake.revision.fingerprint !== inputSnapshot.intakeRevision.fingerprint
  ) {
    throw new BrandGenerationPreconditionError(
      'intake_changed',
      'The frozen brand-intake revision is no longer readable.',
    );
  }
  const finalizedVoice = inputSnapshot.voiceSnapshot
    ? deps.getFinalizedVoiceSnapshotForGeneration({
        workspaceId,
        expectedVoiceVersion: inputSnapshot.voiceSnapshot.voiceVersion,
        expectedFingerprint: inputSnapshot.voiceSnapshot.fingerprint,
        requireCurrentAuthority: false,
      })
    : null;
  const approvedDeliverables = inputSnapshot.approvedDeliverables.map(ref => ({
    ref,
    content: contentAtApprovedVersion(workspaceId, ref, deps),
  }));
  const frozenInput: BrandGenerationFrozenTargetInput = {
    workspaceId,
    inputSnapshot,
    intakeRevision: intake.revision,
    fieldEvidence: intake.fieldEvidence,
    finalizedVoice,
    approvedDeliverables,
  };
  assertExactRequirementCensus(inputSnapshot, runBrandGenerationPreflight(frozenInput));
  return frozenInput;
}
