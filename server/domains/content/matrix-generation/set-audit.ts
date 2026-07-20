import { randomUUID } from 'node:crypto';

import type { AICallOptions, AICallResult } from '../../../ai.js';
import { callAI } from '../../../ai.js';
import { buildGenerationProvenance } from '../../../generation-provenance.js';
import { stripHtmlToText } from '../../../utils/text.js';
import type { BoundedProviderDispatch } from '../../../content-posts-ai.js';
import { MODEL_ROLES } from '../../../model-manifest.js';
import type { PersistedGeneratedPost } from '../../../../shared/types/content.js';
import { isBlockingMatrixGenerationSetAuditFinding } from '../../../../shared/types/matrix-generation.js';
import type {
  MatrixGenerationItem,
  MatrixGenerationSetAuditFinding,
  MatrixGenerationSetAuditReport,
} from '../../../../shared/types/matrix-generation.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';
import {
  parseMatrixGenerationSetAuditAIOutput,
  type MatrixGenerationSetAuditAIOutput,
} from './output-schemas.js';
import {
  MATRIX_GENERATION_SET_AUDIT_MAX_PAGE_TEXT_CHARS,
  MATRIX_GENERATION_SET_AUDIT_SYSTEM_PROMPT,
  projectMatrixGenerationSetAuditPage,
  renderMatrixGenerationSetAuditProviderInput,
} from './set-audit-input.js';

const KEYWORD_OVERLAP_THRESHOLD = 0.75;
const STOP_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'near', 'of', 'the', 'to']);

export interface MatrixGenerationSetAuditCandidate {
  item: MatrixGenerationItem;
  post: PersistedGeneratedPost;
}

export interface MatrixGenerationSetAuditDependencies {
  callAI(options: AICallOptions): Promise<AICallResult>;
}

export interface MatrixGenerationSetAuditResult {
  report: MatrixGenerationSetAuditReport;
  proseRevisionItemIds: string[];
}

/** A partial census blocks run approval without invalidating pages that already passed item audit. */
export function isItemBlockingMatrixGenerationSetAuditFinding(
  item: MatrixGenerationSetAuditFinding,
): boolean {
  return item.code !== 'incomplete_candidate_census'
    && isBlockingMatrixGenerationSetAuditFinding(item);
}

const DEFAULT_DEPENDENCIES: MatrixGenerationSetAuditDependencies = { callAI };

function findingId(input: Omit<MatrixGenerationSetAuditFinding, 'id'>): string {
  return `mgsf_${canonicalGenerationFingerprint(input)}`;
}

function finding(input: Omit<MatrixGenerationSetAuditFinding, 'id'>): MatrixGenerationSetAuditFinding {
  return { id: findingId(input), ...input };
}

function setAuditVerdict(
  findings: readonly MatrixGenerationSetAuditFinding[],
): MatrixGenerationSetAuditReport['verdict'] {
  if (findings.some(item => item.kind === 'structural' && item.severity === 'error')) {
    return 'source_correction_required';
  }
  return findings.some(isBlockingMatrixGenerationSetAuditFinding)
    ? 'needs_attention'
    : 'passed';
}

function normalizeUrl(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, '') || '/';
}

function keywordTerms(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu)
    ?.filter(term => term.length > 1 && !STOP_WORDS.has(term)) ?? []);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const intersection = [...left].filter(term => right.has(term)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

export function runDeterministicMatrixGenerationSetAudit(
  candidates: readonly MatrixGenerationSetAuditCandidate[],
): MatrixGenerationSetAuditFinding[] {
  const findings: MatrixGenerationSetAuditFinding[] = [];
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex];
    if (!left?.item.previewTarget) continue;
    const expectedTemplateBlocks = left.item.previewTarget.blockManifest.blocks
      .filter(block => block.source === 'template').length;
    if (left.post.sections.length !== expectedTemplateBlocks) {
      findings.push(finding({
        source: 'deterministic',
        kind: 'structural',
        code: 'block_manifest_coverage',
        severity: 'error',
        message: 'The generated page does not cover the frozen template block manifest.',
        affectedItemIds: [left.item.id],
        affectedTargetIds: left.item.previewTarget.blockManifest.blocks.map(block => block.id),
        requiresHumanReview: false,
      }));
    }
    if (left.item.previewTarget.evidenceRequirements.some(requirement => requirement.status === 'conflicting')) {
      findings.push(finding({
        source: 'deterministic',
        kind: 'provenance',
        code: 'structured_evidence_conflict',
        severity: 'error',
        message: 'Structured evidence for this page remains conflicting and requires human resolution.',
        affectedItemIds: [left.item.id],
        affectedTargetIds: left.item.previewTarget.evidenceRequirements
          .filter(requirement => requirement.status === 'conflicting')
          .map(requirement => requirement.id),
        requiresHumanReview: true,
      }));
    }
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex];
      if (!right?.item.previewTarget) continue;
      if (normalizeUrl(left.item.previewTarget.plannedUrl)
        === normalizeUrl(right.item.previewTarget.plannedUrl)) {
        findings.push(finding({
          source: 'deterministic',
          kind: 'structural',
          code: 'duplicate_planned_url',
          severity: 'error',
          message: 'Two selected pages resolve to the same planned URL.',
          affectedItemIds: [left.item.id, right.item.id],
          affectedTargetIds: [
            left.item.previewTarget.plannedUrl,
            right.item.previewTarget.plannedUrl,
          ],
          requiresHumanReview: false,
        }));
      }
      const leftKeyword = keywordTerms(left.item.previewTarget.targetKeyword.value);
      const rightKeyword = keywordTerms(right.item.previewTarget.targetKeyword.value);
      const overlap = jaccard(leftKeyword, rightKeyword);
      if (overlap >= KEYWORD_OVERLAP_THRESHOLD) {
        findings.push(finding({
          source: 'deterministic',
          kind: 'structural',
          code: 'keyword_cannibalization',
          severity: 'error',
          message: 'Two selected pages have materially overlapping target-keyword intent.',
          affectedItemIds: [left.item.id, right.item.id],
          affectedTargetIds: [
            left.item.previewTarget.targetKeyword.value,
            right.item.previewTarget.targetKeyword.value,
          ],
          requiresHumanReview: false,
        }));
      }
    }
  }
  return findings;
}

function pageText(post: PersistedGeneratedPost): string {
  const text = stripHtmlToText([
    post.introduction,
    ...post.sections.map(section => section.content),
    post.conclusion,
  ].join('\n'));
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, MATRIX_GENERATION_SET_AUDIT_MAX_PAGE_TEXT_CHARS);
}

function validateModelOutput(
  output: MatrixGenerationSetAuditAIOutput,
  candidates: readonly MatrixGenerationSetAuditCandidate[],
): MatrixGenerationSetAuditAIOutput {
  const itemIds = new Set(candidates.map(candidate => candidate.item.id));
  const targetIds = new Set(candidates.flatMap(candidate => (
    candidate.item.previewTarget?.blockManifest.blocks.map(
      block => `${candidate.item.id}:${block.id}`,
    ) ?? []
  )));
  for (const modelFinding of output.findings) {
    if (modelFinding.affectedItemIds.some(id => !itemIds.has(id))
      || modelFinding.affectedTargetIds.some(id => !targetIds.has(id))) {
      throw new Error('Set audit returned an unknown item or block target');
    }
    if (modelFinding.kind === 'provenance'
      && (!modelFinding.requiresHumanReview || modelFinding.revisionRecommended)) {
      throw new Error('Provenance findings cannot be auto-revised or auto-certified');
    }
  }
  return output;
}

export async function auditMatrixGenerationSet(input: {
  workspaceId: string;
  candidates: readonly MatrixGenerationSetAuditCandidate[];
  expectedCandidateCount: number;
  passCount: 1 | 2;
  signal?: AbortSignal;
  beforeBoundedProviderDispatch?: (dispatch: BoundedProviderDispatch) => void;
  dependencies?: Partial<MatrixGenerationSetAuditDependencies>;
}): Promise<MatrixGenerationSetAuditResult> {
  const deterministic = runDeterministicMatrixGenerationSetAudit(input.candidates);
  if (input.candidates.length !== input.expectedCandidateCount) {
    const censusFinding = finding({
      source: 'deterministic',
      kind: 'provenance',
      code: 'incomplete_candidate_census',
      severity: 'error',
      message: 'The generated candidate census does not match the selected page set.',
      affectedItemIds: input.candidates.map(candidate => candidate.item.id),
      affectedTargetIds: input.candidates.flatMap(candidate => (
        candidate.item.previewTarget?.blockManifest.blocks.slice(0, 1).map(
          block => `${candidate.item.id}:${block.id}`,
        ) ?? []
      )),
      requiresHumanReview: false,
    });
    const findings = [...deterministic, censusFinding];
    return {
      report: {
        verdict: setAuditVerdict(findings),
        findings,
        passCount: input.passCount,
        modelProvenance: null,
        auditedAt: new Date().toISOString(),
      },
      proseRevisionItemIds: [],
    };
  }
  if (input.expectedCandidateCount === 1) {
    return {
      report: {
        verdict: setAuditVerdict(deterministic),
        findings: deterministic,
        passCount: input.passCount,
        modelProvenance: null,
        auditedAt: new Date().toISOString(),
      },
      proseRevisionItemIds: [],
    };
  }
  const pages = input.candidates.map(candidate => projectMatrixGenerationSetAuditPage({
    itemId: candidate.item.id,
    target: candidate.item.previewTarget,
    text: pageText(candidate.post),
  }));
  const { messages, renderedInput } = renderMatrixGenerationSetAuditProviderInput(pages);
  const effectiveInputFingerprint = canonicalGenerationFingerprint({
    ...renderedInput,
    responseFormat: { type: 'json_object' },
  });
  const executionChainId = `matrix-set-audit:${randomUUID()}`;
  input.beforeBoundedProviderDispatch?.({
    provider: 'openai',
    model: MODEL_ROLES.structuredSynthesis,
    fallback: false,
    renderedInput,
    maxOutputTokens: 5_000,
  });
  const result = await (input.dependencies?.callAI ?? DEFAULT_DEPENDENCIES.callAI)({
    operation: 'content-matrix-set-audit',
    model: MODEL_ROLES.structuredSynthesis,
    system: MATRIX_GENERATION_SET_AUDIT_SYSTEM_PROMPT,
    messages,
    workspaceId: input.workspaceId,
    maxTokens: 5_000,
    researchMode: true,
    maxRetries: 0,
    executionChainId,
    signal: input.signal,
  });
  const modelOutput = validateModelOutput(
    parseMatrixGenerationSetAuditAIOutput(result.text),
    input.candidates,
  );
  const modelFindings = modelOutput.findings.map(modelFinding => finding({
    source: 'model',
    kind: modelFinding.kind,
    code: modelFinding.code,
    severity: modelFinding.severity,
    message: modelFinding.message,
    affectedItemIds: modelFinding.affectedItemIds,
    affectedTargetIds: modelFinding.affectedTargetIds,
    requiresHumanReview: modelFinding.requiresHumanReview,
  }));
  const findings = [...deterministic, ...modelFindings];
  const report: MatrixGenerationSetAuditReport = {
    verdict: setAuditVerdict(findings),
    findings,
    passCount: input.passCount,
    modelProvenance: buildGenerationProvenance({
      accepted: {
        execution: result.execution,
        inputFingerprint: effectiveInputFingerprint,
      },
      executionChainId,
      evidenceCapturedAt: input.candidates
        .map(candidate => candidate.item.previewTarget?.evidenceCapturedAt ?? '')
        .sort()
        .at(-1) ?? new Date().toISOString(),
    }),
    auditedAt: new Date().toISOString(),
  };
  return {
    report,
    proseRevisionItemIds: modelOutput.findings
      .filter(item => item.kind === 'prose'
        && item.revisionRecommended
        && !item.requiresHumanReview)
      .flatMap(item => item.affectedItemIds)
      .filter((id, index, values) => values.indexOf(id) === index),
  };
}
