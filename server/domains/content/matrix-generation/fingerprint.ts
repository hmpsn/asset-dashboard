import type {
  ResolvedMatrixStructuralTarget,
  ResolvedPageBlockManifest,
} from '../../../../shared/types/matrix-generation.js';
import { canonicalGenerationFingerprint } from '../../../generation-provenance.js';

export { canonicalGenerationFingerprint };

type BlockManifestFingerprintSource = Pick<
  ResolvedPageBlockManifest,
  'generationContractVersion' | 'blocks' | 'totalWordCountTarget'
>;

/** Exact block-manifest payload protected by `ResolvedPageBlockManifest.fingerprint`. */
export function blockManifestFingerprintCore(
  manifest: BlockManifestFingerprintSource,
): BlockManifestFingerprintSource {
  return {
    generationContractVersion: manifest.generationContractVersion,
    blocks: manifest.blocks,
    totalWordCountTarget: manifest.totalWordCountTarget,
  };
}

export function computeBlockManifestFingerprint(
  manifest: BlockManifestFingerprintSource,
): string {
  return canonicalGenerationFingerprint(blockManifestFingerprintCore(manifest));
}

type StructuralTargetFingerprintSource = Pick<
  ResolvedMatrixStructuralTarget,
  | 'workspaceId'
  | 'matrixId'
  | 'templateId'
  | 'cellId'
  | 'sourceRevision'
  | 'variableValues'
  | 'slugSubstitutions'
  | 'proseSubstitutions'
  | 'targetKeyword'
  | 'plannedUrl'
  | 'title'
  | 'metaDescription'
  | 'renderedHeadings'
  | 'pageType'
  | 'schemaTypes'
  | 'blockManifest'
  | 'generationContractVersion'
  | 'structuralRequirements'
  | 'structuralBlockingRequirementIds'
>;

/**
 * Picks the exact source-only structural payload used by resolution and
 * persistence verification. Preview-only voice/evidence/budget fields never
 * change this fingerprint.
 */
export function structuralTargetFingerprintCore(
  target: StructuralTargetFingerprintSource,
): StructuralTargetFingerprintSource {
  return {
    workspaceId: target.workspaceId,
    matrixId: target.matrixId,
    templateId: target.templateId,
    cellId: target.cellId,
    sourceRevision: target.sourceRevision,
    variableValues: target.variableValues,
    slugSubstitutions: target.slugSubstitutions,
    proseSubstitutions: target.proseSubstitutions,
    targetKeyword: target.targetKeyword,
    plannedUrl: target.plannedUrl,
    title: target.title,
    metaDescription: target.metaDescription,
    renderedHeadings: target.renderedHeadings,
    pageType: target.pageType,
    schemaTypes: target.schemaTypes,
    blockManifest: target.blockManifest,
    generationContractVersion: target.generationContractVersion,
    structuralRequirements: target.structuralRequirements,
    structuralBlockingRequirementIds: target.structuralBlockingRequirementIds,
  };
}

export function computeStructuralTargetFingerprint(
  target: StructuralTargetFingerprintSource,
): string {
  return canonicalGenerationFingerprint(structuralTargetFingerprintCore(target));
}
