import type {
  BrandGenerationCandidateAttemptOutput,
} from '../../../../shared/types/brand-generation.js';
import type {
  GenerationAuditCheck,
  GenerationAuditReport,
  GenerationAutomaticRevisionCount,
  GenerationHumanRequiredAuditCheck,
} from '../../../../shared/types/generation-evidence.js';
import {
  STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES,
} from '../../../../shared/types/generation-evidence.js';
import type { BrandModelAuditAIOutput } from './output-schemas.js';
import { parseBrandGenerationAuditReport } from './output-schemas.js';
import type {
  BrandGenerationFrozenTargetInput,
  BrandGenerationPreflightResult,
} from './preflight.js';
import type { BrandGenerationRelatedCandidate } from './prompt.js';

export interface BrandGenerationDeterministicAuditInput {
  frozenInput: BrandGenerationFrozenTargetInput;
  preflight: BrandGenerationPreflightResult;
  candidate: BrandGenerationCandidateAttemptOutput;
  revisionCount: GenerationAutomaticRevisionCount;
  now?: () => Date;
}

export interface MergeBrandGenerationAuditInput {
  frozenInput: BrandGenerationFrozenTargetInput;
  deterministicReport: GenerationAuditReport;
  modelOutput: BrandModelAuditAIOutput;
  relatedCandidates?: readonly BrandGenerationRelatedCandidate[];
}

export type BrandGenerationAuditDisposition =
  | 'ready'
  | 'revise'
  | 'needs_attention'
  | 'blocked_missing_evidence';

export class BrandGenerationAuditContractError extends Error {
  readonly code = 'brand_generation_audit_contract';

  constructor(message: string) {
    super(message);
    this.name = 'BrandGenerationAuditContractError';
  }
}

function candidateText(candidate: BrandGenerationCandidateAttemptOutput): string {
  if (candidate.kind === 'deliverable_candidate') return candidate.content;
  const draft = candidate.foundationDraft;
  return [
    draft.summary,
    ...draft.voiceDNA.personalityTraits,
    draft.voiceDNA.sentenceStyle,
    draft.voiceDNA.vocabularyLevel,
    draft.voiceDNA.humorStyle ?? '',
    ...draft.contextModifiers.flatMap(modifier => [modifier.context, modifier.description]),
  ].filter(Boolean).join('\n');
}

function check(
  id: string,
  category: string,
  passed: boolean,
  passedMessage: string,
  failedMessage: string,
  evidenceRequirementIds: string[] = [],
): GenerationAuditCheck {
  return {
    id,
    category,
    result: passed ? 'passed' : 'failed',
    message: passed ? passedMessage : failedMessage,
    evidenceRequirementIds,
  };
}

function exactPlaceholderCheck(
  preflight: BrandGenerationPreflightResult,
  candidate: BrandGenerationCandidateAttemptOutput,
): GenerationAuditCheck {
  const text = candidateText(candidate);
  const placeholderText = candidate.kind === 'foundation_candidate'
    ? JSON.stringify(candidate.foundationDraft)
    : text;
  const expected = preflight.attemptOutput.placeholders.map(placeholder => placeholder.token).sort();
  const declared = candidate.placeholders.map(placeholder => placeholder.token).sort();
  const rendered = [...placeholderText.matchAll(/\[NEEDS CLIENT INPUT:[^\]]+\]/g)].map(match => match[0]).sort();
  const passed = JSON.stringify(expected) === JSON.stringify(declared)
    && JSON.stringify(expected) === JSON.stringify(rendered);
  return check(
    'placeholder-completeness',
    'grounding',
    passed,
    'Every typed placeholder survives exactly once.',
    'A typed placeholder was deleted, changed, duplicated, or invented.',
    candidate.placeholders.map(placeholder => placeholder.requirementId),
  );
}

function factualClaimCheck(candidate: BrandGenerationCandidateAttemptOutput): GenerationAuditCheck {
  const structural = new Set<string>(STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES);
  const invalid = candidate.claims.some(claim => (
    claim.classification === 'factual'
    && (
      claim.sourceRefs.length === 0
      || claim.sourceRefs.some(source => structural.has(source.sourceType))
    )
  ));
  return check(
    'factual-claim-evidence',
    'grounding',
    !invalid,
    'Every declared factual claim carries non-structural evidence.',
    'A declared factual claim is unsupported or cites structural-only evidence.',
  );
}

function sensitiveClaimCheck(candidate: BrandGenerationCandidateAttemptOutput): GenerationAuditCheck {
  const text = candidateText(candidate);
  const matches = [
    ...text.matchAll(/\b\d+(?:,\d{3})*(?:\.\d+)?(?:%|\+|\s+(?:years?|clients?|customers?|patients?|locations?|awards?|reviews?))\b/gi),
    ...text.matchAll(/\b(?:licensed|certified|accredited|award-winning|board-certified|guaranteed)\b/gi),
  ].map(match => match[0].toLowerCase());
  const factualText = candidate.claims
    .filter(claim => claim.classification === 'factual')
    .map(claim => claim.text.toLowerCase());
  const unsupported = matches.some(match => !factualText.some(claim => claim.includes(match)));
  return check(
    'sensitive-claim-declaration',
    'grounding',
    !unsupported,
    'Every metric, credential, award, and guarantee is declared as an evidenced factual claim.',
    'A metric, credential, award, or guarantee appears outside the evidenced factual-claim ledger.',
  );
}

function voiceGuardrailCheck(
  input: BrandGenerationFrozenTargetInput,
  candidate: BrandGenerationCandidateAttemptOutput,
): GenerationAuditCheck {
  if (!input.finalizedVoice || input.inputSnapshot.target === 'voice_foundation') {
    return {
      id: 'voice-guardrails',
      category: 'voice',
      result: 'not_applicable',
      message: 'Bootstrap has no finalized downstream voice authority.',
      evidenceRequirementIds: [],
    };
  }
  const text = candidateText(candidate).toLowerCase();
  const forbidden = input.finalizedVoice.guardrails.forbiddenWords
    .filter(word => word.trim() && text.includes(word.trim().toLowerCase()));
  const wrongTerminology = input.finalizedVoice.guardrails.requiredTerminology.filter(term => (
    text.includes(term.insteadOf.toLowerCase()) && !text.includes(term.use.toLowerCase())
  ));
  return check(
    'voice-guardrails',
    'voice',
    forbidden.length === 0 && wrongTerminology.length === 0,
    'The candidate respects the frozen lexical voice guardrails.',
    'The candidate violates a forbidden-word or required-terminology guardrail.',
    ['brand-voice:finalized'],
  );
}

function creativeProposalCheck(
  input: BrandGenerationFrozenTargetInput,
  candidate: BrandGenerationCandidateAttemptOutput,
): GenerationAuditCheck {
  const target = input.inputSnapshot.target;
  if (target !== 'naming' && target !== 'tagline') {
    return {
      id: 'creative-proposal-classification',
      category: 'claims',
      result: 'not_applicable',
      message: 'This target is not the naming or tagline proposal surface.',
      evidenceRequirementIds: [],
    };
  }
  return check(
    'creative-proposal-classification',
    'claims',
    candidate.claims.some(claim => claim.classification === 'creative_proposal'),
    'The naming or tagline output is explicitly classified as a creative proposal.',
    'The naming or tagline output is not explicitly classified as a creative proposal.',
  );
}

function namingClearanceCheck(
  input: BrandGenerationFrozenTargetInput,
  candidate: BrandGenerationCandidateAttemptOutput,
): GenerationAuditCheck {
  if (input.inputSnapshot.target !== 'naming') {
    return {
      id: 'naming-clearance-boundary',
      category: 'claims',
      result: 'not_applicable',
      message: 'This target is not naming.',
      evidenceRequirementIds: [],
    };
  }
  const text = candidateText(candidate);
  const positiveClearance = /(?:trademark|domain|legal|cultural)[^.!?]{0,40}(?:available|cleared|verified|safe|vetted)/i.test(text)
    && !/(?:not|never|hasn['’]t|have not)[^.!?]{0,40}(?:verified|checked|cleared|vetted)/i.test(text);
  const hasDisclaimer = /trademark/i.test(text)
    && /domain/i.test(text)
    && /legal/i.test(text)
    && /cultur/i.test(text)
    && /(?:not|never|hasn['’]t|have not)[^.!?]{0,60}(?:verified|checked|cleared|vetted)/i.test(text);
  return check(
    'naming-clearance-boundary',
    'claims',
    hasDisclaimer && !positiveClearance,
    'Naming remains an explicit unverified creative proposal.',
    'Naming implies clearance or omits the trademark/domain/legal/cultural verification boundary.',
  );
}

function humanChecks(candidate: BrandGenerationCandidateAttemptOutput): GenerationHumanRequiredAuditCheck[] {
  const hasFactualClaims = candidate.claims.some(claim => claim.classification === 'factual');
  return [
    {
      id: 'factual-accuracy',
      category: 'provenance',
      result: hasFactualClaims ? 'needs_human_review' : 'not_applicable',
      message: hasFactualClaims
        ? 'A human must verify factual accuracy against the cited sources.'
        : 'The candidate declares no factual claims.',
      evidenceRequirementIds: [],
    },
    {
      id: 'no-hallucinations',
      category: 'provenance',
      result: hasFactualClaims ? 'needs_human_review' : 'not_applicable',
      message: hasFactualClaims
        ? 'A human must confirm the candidate introduces no unsupported factual implication.'
        : 'The candidate declares no factual claims.',
      evidenceRequirementIds: [],
    },
  ];
}

export function runBrandGenerationDeterministicAudit(
  input: BrandGenerationDeterministicAuditInput,
): GenerationAuditReport {
  const checks = [
    exactPlaceholderCheck(input.preflight, input.candidate),
    factualClaimCheck(input.candidate),
    sensitiveClaimCheck(input.candidate),
    voiceGuardrailCheck(input.frozenInput, input.candidate),
    creativeProposalCheck(input.frozenInput, input.candidate),
    namingClearanceCheck(input.frozenInput, input.candidate),
  ];
  const unresolvedRequirementIds = input.candidate.requirements
    .filter(requirement => (
      requirement.requirementStage === 'ready'
      && (requirement.status === 'missing' || requirement.status === 'conflicting')
    ))
    .map(requirement => requirement.id);
  const verdict = unresolvedRequirementIds.length > 0
    ? 'blocked_missing_evidence'
    : checks.some(item => item.result === 'failed')
      ? 'needs_attention'
      : 'ready_for_human_review';
  return parseBrandGenerationAuditReport({
    verdict,
    deterministicChecks: checks,
    modelFindings: [],
    humanRequiredChecks: humanChecks(input.candidate),
    revisionCount: input.revisionCount,
    unresolvedRequirementIds,
    auditedAt: (input.now?.() ?? new Date()).toISOString(),
  });
}

export function mergeBrandGenerationAudit(
  input: MergeBrandGenerationAuditInput,
): GenerationAuditReport {
  const allowedTargets = new Set<string>([
    input.frozenInput.inputSnapshot.target,
    ...(input.relatedCandidates ?? []).map(related => related.targetId),
  ]);
  for (const finding of input.modelOutput.findings) {
    if (finding.affectedTargetIds.some(targetId => !allowedTargets.has(targetId))) {
      throw new BrandGenerationAuditContractError('Model audit returned an unknown affected target identity.');
    }
  }
  const unresolved = [...input.deterministicReport.unresolvedRequirementIds];
  const deterministicFailed = input.deterministicReport.deterministicChecks
    .some(item => item.result === 'failed');
  const modelNeedsAttention = input.modelOutput.revisionRecommended
    || input.modelOutput.findings.some(finding => finding.severity !== 'info');
  const verdict = unresolved.length > 0
    ? 'blocked_missing_evidence'
    : deterministicFailed || modelNeedsAttention
      ? 'needs_attention'
      : 'ready_for_human_review';
  return parseBrandGenerationAuditReport({
    ...input.deterministicReport,
    verdict,
    modelFindings: input.modelOutput.findings,
    unresolvedRequirementIds: unresolved,
  });
}

export function getBrandGenerationAuditDisposition(
  report: GenerationAuditReport,
  revisionCount: GenerationAutomaticRevisionCount,
): BrandGenerationAuditDisposition {
  if (report.revisionCount !== revisionCount) {
    throw new BrandGenerationAuditContractError('Audit report revision count does not match the item.');
  }
  if (report.verdict === 'blocked_missing_evidence') return 'blocked_missing_evidence';
  if (report.verdict === 'ready_for_human_review') return 'ready';
  return revisionCount === 0 ? 'revise' : 'needs_attention';
}
