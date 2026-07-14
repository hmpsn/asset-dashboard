import type {
  GenerationEvidenceRequirement,
  GenerationEvidenceSourceRef,
} from '../../../../shared/types/generation-evidence.js';

export function structuralBlocker(
  id: string,
  fieldPath: string,
  claim: string,
  reason: string,
  clientSafePrompt?: string,
): GenerationEvidenceRequirement {
  return {
    id,
    fieldPath,
    claim,
    reason,
    requirementStage: 'preflight',
    claimKind: 'structural',
    status: 'missing',
    sourceRefs: [],
    ...(clientSafePrompt ? { clientSafePrompt } : {}),
  };
}

export function verifiedStructuralRequirement(
  id: string,
  fieldPath: string,
  claim: string,
  reason: string,
  sourceRefs: [GenerationEvidenceSourceRef, ...GenerationEvidenceSourceRef[]],
): GenerationEvidenceRequirement {
  return {
    id,
    fieldPath,
    claim,
    reason,
    requirementStage: 'preflight',
    claimKind: 'structural',
    status: 'verified',
    sourceRefs,
  };
}
