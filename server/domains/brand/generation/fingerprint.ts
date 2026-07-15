import { createHash } from 'node:crypto';

import type {
  ApprovedBrandDeliverableRef,
  BrandGenerationTargetInputSnapshot,
  ResumeBrandGenerationCommandSnapshot,
  ResumeBrandGenerationRequest,
  ReviseBrandGenerationItemCommandSnapshot,
  ReviseBrandGenerationItemRequest,
  StartBrandGenerationCommandSnapshot,
  StartBrandGenerationRequest,
} from '../../../../shared/types/brand-generation.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** Stable SHA-256 over business inputs. Callers must pass no secrets or raw prompts. */
export function canonicalBrandGenerationFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function brandGenerationApprovalFingerprint(
  ref: Omit<ApprovedBrandDeliverableRef, 'approvalFingerprint'>,
): string {
  return canonicalBrandGenerationFingerprint({
    deliverableId: ref.deliverableId,
    deliverableType: ref.deliverableType,
    version: ref.version,
    approvedAt: ref.approvedAt,
    contentFingerprint: ref.contentFingerprint,
    status: 'approved',
  });
}

export function brandGenerationSnapshotFingerprint(
  snapshot: Omit<BrandGenerationTargetInputSnapshot, 'fingerprint'>,
): string {
  return canonicalBrandGenerationFingerprint(snapshot);
}

export function brandGenerationSnapshotFingerprintsAreValid(
  snapshot: BrandGenerationTargetInputSnapshot,
): boolean {
  const { fingerprint, ...core } = snapshot;
  return brandGenerationSnapshotFingerprint(core) === fingerprint
    && snapshot.approvedDeliverables.every(ref => {
      const { approvalFingerprint, ...approval } = ref;
      return brandGenerationApprovalFingerprint(approval) === approvalFingerprint;
    });
}

export function startBrandGenerationCommandSnapshot(
  request: StartBrandGenerationRequest,
): StartBrandGenerationCommandSnapshot {
  const {
    idempotencyKey: _idempotencyKey,
    createdBy: _createdBy,
    mcpExecutionContext: _mcpExecutionContext,
    ...businessInputs
  } = request;
  return businessInputs;
}

export function resumeBrandGenerationCommandSnapshot(
  request: ResumeBrandGenerationRequest,
): ResumeBrandGenerationCommandSnapshot {
  const {
    idempotencyKey: _idempotencyKey,
    resumedBy: _resumedBy,
    mcpExecutionContext: _mcpExecutionContext,
    ...businessInputs
  } = request;
  return businessInputs;
}

export function reviseBrandGenerationItemCommandSnapshot(
  request: ReviseBrandGenerationItemRequest,
): ReviseBrandGenerationItemCommandSnapshot {
  const {
    idempotencyKey: _idempotencyKey,
    requestedBy: _requestedBy,
    mcpExecutionContext: _mcpExecutionContext,
    ...businessInputs
  } = request;
  return businessInputs;
}
