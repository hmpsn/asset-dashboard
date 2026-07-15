import { describe, expect, it } from 'vitest';

import type { GeneratedPost } from '../../shared/types/content.js';
import type { VoiceGuardrails } from '../../shared/types/brand-engine.js';
import type {
  GenerationEvidenceRequirement,
  GenerationEvidenceValue,
} from '../../shared/types/generation-evidence.js';
import type { MatrixGenerationPreviewTarget } from '../../shared/types/matrix-generation.js';
import { resolveMatrixStructure } from '../../server/domains/content/matrix-generation/resolver.js';
import {
  getMatrixGenerationAuditDisposition,
  mergeMatrixGenerationAudit,
  runMatrixGenerationDeterministicAudit,
} from '../../server/domains/content/matrix-generation/audit.js';
import {
  applyMatrixGenerationRevision,
} from '../../server/domains/content/matrix-generation/operations.js';
import {
  parseMatrixGenerationModelAuditAIOutput,
  parseMatrixGenerationRevisionAIOutput,
} from '../../server/domains/content/matrix-generation/output-schemas.js';

const NOW = '2026-07-14T12:00:00.000Z';
const LOCATION_REQUIREMENT = 'matrix-cell:cell-1:location-relevance';
const CTA_REQUIREMENT = 'matrix-cell:cell-1:cta-details';

const voiceGuardrails: VoiceGuardrails = {
  forbiddenWords: ['guaranteed'],
  requiredTerminology: [{ use: 'client', insteadOf: 'customer' }],
  toneBoundaries: ['Never pressure the reader.'],
  antiPatterns: ['Unsupported superlatives'],
};

function requirement(
  id: string,
  fieldPath: string,
  status: GenerationEvidenceRequirement['status'] = 'verified',
): GenerationEvidenceRequirement {
  return {
    id,
    fieldPath,
    claim: `Verified ${fieldPath}`,
    reason: `${fieldPath} must be grounded.`,
    requirementStage: id === CTA_REQUIREMENT ? 'ready' : 'preflight',
    claimKind: 'factual',
    status,
    sourceRefs: status === 'verified'
      ? [{
          sourceType: 'content_matrix_cell_evidence',
          sourceId: `evidence:${id}`,
          capturedAt: NOW,
        }]
      : [],
    clientSafePrompt: id === CTA_REQUIREMENT
      ? 'Provide the verified CTA destination or instruction for this page.'
      : undefined,
  };
}

function target(
  overrides: Partial<MatrixGenerationPreviewTarget> = {},
): MatrixGenerationPreviewTarget {
  const resolved = resolveMatrixStructure({
    workspaceId: 'ws-1',
    matrix: {
      id: 'matrix-1',
      workspaceId: 'ws-1',
      revision: 3,
      name: 'Local services',
      templateId: 'template-1',
      dimensions: [
        { variableName: 'service', values: ['SEO consulting'] },
        { variableName: 'city', values: ['Austin'] },
      ],
      urlPattern: '/{city}/{service}',
      keywordPattern: '{service} {city}',
      cells: [{
        id: 'cell-1',
        revision: 4,
        variableValues: { service: 'SEO consulting', city: 'Austin' },
        targetKeyword: 'seo consulting austin',
        plannedUrl: '/austin/seo-consulting',
        status: 'keyword_validated',
      }],
      stats: { total: 1, planned: 1, briefGenerated: 0, drafted: 0, reviewed: 0, published: 0 },
      createdAt: NOW,
      updatedAt: NOW,
    },
    template: {
      id: 'template-1',
      workspaceId: 'ws-1',
      revision: 2,
      name: 'Local service template',
      pageType: 'location',
      variables: [
        { name: 'service', label: 'Service' },
        { name: 'city', label: 'City' },
      ],
      sections: [
        {
          id: 'answer',
          name: 'Direct answer',
          headingTemplate: '{service} in {city}',
          guidance: 'Answer the search intent directly.',
          wordCountTarget: 80,
          order: 0,
          generationRole: 'answer_first',
          aeoContract: { modes: ['answer_first'], required: true },
          ctaContract: { role: 'none', required: false },
        },
        {
          id: 'faq',
          name: 'FAQ',
          headingTemplate: '{service} questions',
          guidance: 'Answer a common question.',
          wordCountTarget: 80,
          order: 1,
          generationRole: 'faq',
          aeoContract: { modes: ['faq'], required: true },
          ctaContract: { role: 'none', required: false },
        },
        {
          id: 'cta',
          name: 'CTA',
          headingTemplate: 'Schedule {service}',
          guidance: 'Give the reader one clear next step.',
          wordCountTarget: 50,
          order: 2,
          generationRole: 'cta',
          aeoContract: { modes: [], required: false },
          ctaContract: { role: 'primary', required: true },
        },
      ],
      urlPattern: '/{city}/{service}',
      keywordPattern: '{service} {city}',
      titlePattern: 'SEO consulting in Austin',
      metaDescPattern: 'Practical SEO consulting for Austin organizations.',
      generationContractVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
    cell: {
      id: 'cell-1',
      revision: 4,
      variableValues: { service: 'SEO consulting', city: 'Austin' },
      targetKeyword: 'seo consulting austin',
      plannedUrl: '/austin/seo-consulting',
      status: 'keyword_validated',
    },
    expectedSourceRevision: { matrixRevision: 3, templateRevision: 2, cellRevision: 4 },
    matrixPlannedUrls: [{ cellId: 'cell-1', plannedUrl: '/austin/seo-consulting' }],
    knownWorkspacePagePaths: ['/about', '/contact'],
  });
  if (resolved.status !== 'resolved') throw new Error('Expected a resolved target fixture');

  return {
    ...resolved.target,
    voiceSnapshot: {
      voiceProfileId: 'voice-1',
      voiceVersion: 1,
      finalizedBy: { actorType: 'operator', actorId: 'operator-1' },
      finalizedAt: NOW,
      fingerprint: 'a'.repeat(64),
      anchorEvidenceRefs: [{
        sourceType: 'voice_sample',
        sourceId: 'sample-1',
        voiceSampleSource: 'manual',
        capturedAt: NOW,
        selectedBy: { actorType: 'operator', actorId: 'operator-1' },
        selectedAt: NOW,
      }],
    },
    identitySnapshot: [],
    evidenceRequirements: [
      requirement('matrix-cell:cell-1:service-availability', 'service.availability'),
      requirement(LOCATION_REQUIREMENT, 'location.relevance'),
      requirement(CTA_REQUIREMENT, 'cta.details'),
    ],
    evidenceCapturedAt: NOW,
    evidenceFreshThrough: NOW,
    expectedArtifactRevisions: {
      brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
      post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
    },
    effectiveInputFingerprint: 'b'.repeat(64),
    blockingRequirementIds: [],
    estimatedPaidBudget: {
      providerCalls: 6,
      inputTokens: 2_000,
      outputTokens: 2_000,
      estimatedUsd: 0.07,
      maxConcurrency: 1,
    },
    ...overrides,
  };
}

function post(targetValue = target()): GeneratedPost {
  const sections = targetValue.blockManifest.blocks.filter(block => block.source === 'template');
  return {
    id: 'post-1',
    workspaceId: targetValue.workspaceId,
    briefId: 'brief-1',
    targetKeyword: targetValue.targetKeyword.value,
    title: targetValue.title,
    metaDescription: targetValue.metaDescription,
    seoTitle: targetValue.title,
    seoMetaDescription: targetValue.metaDescription,
    introduction: '<p>SEO consulting in Austin gives local organizations a clear, practical way to improve useful search visibility without inflated promises or confusing jargon.</p>',
    sections: [
      {
        index: 0,
        heading: sections[0]?.heading.renderedText ?? '',
        content: '<p>SEO consulting in Austin starts with a direct review of the pages people use to understand a service. The work focuses on clear priorities, useful explanations, and measurable search improvements for the client.</p>',
        wordCount: 32,
        targetWordCount: 80,
        keywords: [targetValue.targetKeyword.value],
        status: 'done',
      },
      {
        index: 1,
        heading: sections[1]?.heading.renderedText ?? '',
        content: '<p>What does an SEO consulting engagement include?</p><p>It includes a focused review, an ordered plan, and clear recommendations the client can evaluate before deciding what to implement.</p>',
        wordCount: 27,
        targetWordCount: 80,
        keywords: [],
        status: 'done',
      },
      {
        index: 2,
        heading: sections[2]?.heading.renderedText ?? '',
        content: '<p>Serving Austin businesses with on-site workshops in the verified downtown service area. <a href="https://example.com/contact">Schedule an SEO consulting conversation</a> when the timing is right.</p>',
        wordCount: 25,
        targetWordCount: 50,
        keywords: [],
        status: 'done',
      },
    ],
    conclusion: '<p>Review the priorities, ask questions, and choose the next step that makes sense for your organization.</p>',
    totalWordCount: 120,
    targetWordCount: targetValue.blockManifest.totalWordCountTarget,
    status: 'draft',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function evidence(
  requirementId: string,
  value: GenerationEvidenceValue,
): Pick<import('../../shared/types/matrix-generation.js').MatrixGenerationEvidenceResolution, 'requirementId' | 'value'> {
  return { requirementId, value };
}

function audit(overrides: {
  target?: MatrixGenerationPreviewTarget;
  post?: GeneratedPost;
  knownInternalPaths?: string[];
  revisionCount?: 0 | 1;
} = {}) {
  const targetValue = overrides.target ?? target();
  return runMatrixGenerationDeterministicAudit({
    target: targetValue,
    post: overrides.post ?? post(targetValue),
    evidenceResolutions: [
      evidence('matrix-cell:cell-1:service-availability', { kind: 'boolean', value: true }),
      evidence(LOCATION_REQUIREMENT, {
        kind: 'text',
        value: 'Serving Austin businesses with on-site workshops in the verified downtown service area.',
      }),
      evidence(CTA_REQUIREMENT, { kind: 'url', value: 'https://example.com/contact' }),
    ],
    knownInternalPaths: overrides.knownInternalPaths ?? ['/about', '/contact'],
    internalPathCensusComplete: true,
    voiceGuardrails,
    revisionCount: overrides.revisionCount ?? 0,
    now: () => new Date(NOW),
  });
}

function checkResult(report: ReturnType<typeof audit>, id: string) {
  return report.deterministicChecks.find(check => check.id === id)?.result;
}

describe('content matrix generation deterministic audit', () => {
  it('passes a grounded locked page to human review while keeping factual checks human-owned', () => {
    const report = audit();

    expect(report.verdict).toBe('ready_for_human_review');
    expect(report.deterministicChecks.length).toBeGreaterThan(0);
    expect(report.deterministicChecks.every(check => ( // every-ok -- non-empty asserted above
      check.result === 'passed' || check.result === 'not_applicable'
    ))).toBe(true);
    expect(report.humanRequiredChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'factual-accuracy', result: 'needs_human_review' }),
      expect.objectContaining({ id: 'no-hallucinations', result: 'needs_human_review' }),
    ]));
  });

  it('fails locked structure, key-position coverage, CTA/AEO roles, and nonexistent paths deterministically', () => {
    const targetValue = target();
    const candidate = post(targetValue);
    candidate.introduction = '<p>A clear service page without the target location.</p>';
    candidate.sections[0] = {
      ...candidate.sections[0],
      heading: 'Changed heading',
    };
    candidate.sections[1] = {
      ...candidate.sections[1],
      content: '<p>A general paragraph without a question and answer structure.</p>',
    };
    candidate.sections[2] = {
      ...candidate.sections[2],
      content: '<p><a href="/not-a-real-page">Schedule through another resource</a>.</p>',
    };

    const report = audit({ target: targetValue, post: candidate });

    expect(report.verdict).toBe('needs_attention');
    expect(checkResult(report, 'template-block-census')).toBe('failed');
    expect(checkResult(report, 'keyword-introduction-coverage')).toBe('failed');
    expect(checkResult(report, 'aeo-contracts')).toBe('failed');
    expect(checkResult(report, 'cta-contracts')).toBe('failed');
    expect(checkResult(report, 'internal-paths')).toBe('failed');
  });

  it('fails metadata that exceeds the platform hard limits', () => {
    const targetValue = target({
      title: `SEO consulting Austin ${'x'.repeat(45)}`,
      metaDescription: `SEO consulting Austin ${'x'.repeat(145)}`,
    });
    const report = audit({ target: targetValue, post: post(targetValue) });

    expect(checkResult(report, 'locked-metadata')).toBe('passed');
    expect(checkResult(report, 'metadata-lengths')).toBe('failed');
  });

  it('fails thin variable-only location copy, duplicated blocks, and lexical voice violations', () => {
    const targetValue = target();
    const candidate = post(targetValue);
    const repeated = '<p>SEO consulting Austin. SEO consulting Austin. SEO consulting Austin.</p>';
    candidate.introduction = repeated;
    candidate.sections = candidate.sections.map(section => ({
      ...section,
      content: `${repeated}<p>Our guaranteed approach is clear for every customer.</p>`,
    }));
    candidate.conclusion = repeated;

    const report = audit({ target: targetValue, post: candidate });

    expect(checkResult(report, 'local-evidence')).toBe('failed');
    expect(checkResult(report, 'substantive-uniqueness')).toBe('failed');
    expect(checkResult(report, 'voice-guardrails')).toBe('failed');
  });

  it('uses structured ready-stage gaps as blockers and requires each canonical placeholder exactly once', () => {
    const unresolvedTarget = target({
      evidenceRequirements: [
        requirement('matrix-cell:cell-1:service-availability', 'service.availability'),
        requirement(LOCATION_REQUIREMENT, 'location.relevance'),
        requirement(CTA_REQUIREMENT, 'cta.details', 'missing'),
      ],
    });
    const candidate = post(unresolvedTarget);
    candidate.sections[2].content += '<p>[NEEDS CLIENT INPUT: Provide the verified CTA destination or instruction for this page.]</p>';

    const report = audit({ target: unresolvedTarget, post: candidate });

    expect(report.verdict).toBe('blocked_missing_evidence');
    expect(report.unresolvedRequirementIds).toEqual([CTA_REQUIREMENT]);
    expect(checkResult(report, 'placeholder-completeness')).toBe('passed');

    candidate.sections[2].content = candidate.sections[2].content.replace(
      '[NEEDS CLIENT INPUT: Provide the verified CTA destination or instruction for this page.]',
      '',
    );
    expect(checkResult(audit({ target: unresolvedTarget, post: candidate }), 'placeholder-completeness'))
      .toBe('failed');
  });
});

describe('content matrix generation model audit merge', () => {
  it('cannot override deterministic failures and routes an invented local claim to revision', () => {
    const deterministic = audit();
    const merged = mergeMatrixGenerationAudit({
      target: target(),
      deterministicReport: deterministic,
      modelOutput: {
        revisionRecommended: true,
        findings: [{
          code: 'unsupported_local_claim',
          severity: 'error',
          message: 'The draft claims a nearby landmark that is absent from verified evidence.',
          affectedTargetIds: ['template:cta'],
          requiresHumanReview: true,
        }],
      },
    });

    expect(merged.verdict).toBe('needs_attention');
    expect(getMatrixGenerationAuditDisposition(merged, 0, true)).toBe('revise');
    expect(getMatrixGenerationAuditDisposition({ ...merged, revisionCount: 1 }, 1, true))
      .toBe('needs_attention');

    const brokenCandidate = post();
    brokenCandidate.introduction = '<p>Missing target terms.</p>';
    const deterministicFailure = audit({ post: brokenCandidate });
    const modelPass = mergeMatrixGenerationAudit({
      target: target(),
      deterministicReport: deterministicFailure,
      modelOutput: { revisionRecommended: false, findings: [] },
    });
    expect(modelPass.verdict).toBe('needs_attention');
    expect(checkResult(modelPass, 'keyword-introduction-coverage')).toBe('failed');
  });

  it('does not spend the revision allowance when the model marks a finding for attention only', () => {
    const deterministic = audit();
    const merged = mergeMatrixGenerationAudit({
      target: target(),
      deterministicReport: deterministic,
      modelOutput: {
        revisionRecommended: false,
        findings: [{
          code: 'human_context',
          severity: 'warning',
          message: 'A human should confirm this implication before review.',
          affectedTargetIds: ['template:cta'],
          requiresHumanReview: true,
        }],
      },
    });

    expect(merged.verdict).toBe('needs_attention');
    expect(getMatrixGenerationAuditDisposition(merged, 0, false)).toBe('needs_attention');
  });

  it('rejects model findings that do not address a frozen block identity', () => {
    expect(() => mergeMatrixGenerationAudit({
      target: target(),
      deterministicReport: audit(),
      modelOutput: {
        revisionRecommended: true,
        findings: [{
          code: 'unknown_target',
          severity: 'warning',
          message: 'Unknown block.',
          affectedTargetIds: ['template:not-real'],
          requiresHumanReview: false,
        }],
      },
    })).toThrow(/unknown affected target/i);
  });
});

describe('content matrix generation structured operation contracts', () => {
  it('accepts only the typed model audit shape', () => {
    expect(parseMatrixGenerationModelAuditAIOutput(JSON.stringify({
      revisionRecommended: false,
      findings: [],
    }))).toEqual({ revisionRecommended: false, findings: [] });
    expect(() => parseMatrixGenerationModelAuditAIOutput(JSON.stringify({
      revisionRecommended: false,
      findings: [],
      verdict: 'approved',
    }))).toThrow(/structured output/i);
  });

  it('preserves frozen block identities and headings when applying one revision', () => {
    const targetValue = target();
    const candidate = post(targetValue);
    const output = parseMatrixGenerationRevisionAIOutput(JSON.stringify({
      blocks: targetValue.blockManifest.blocks.map((block, index) => ({
        targetId: block.id,
        html: `<p>Revised grounded block ${index + 1} for SEO consulting in Austin.</p>`,
      })),
    }));

    const revised = applyMatrixGenerationRevision(targetValue, candidate, output);

    expect(revised.sections.map(section => section.heading))
      .toEqual(candidate.sections.map(section => section.heading));
    expect(revised.sections.map(section => section.index))
      .toEqual(candidate.sections.map(section => section.index));
    expect(revised.introduction).toContain('Revised grounded block 1');
    expect(revised.conclusion).toContain('Revised grounded block 5');

    expect(() => applyMatrixGenerationRevision(targetValue, candidate, {
      blocks: output.blocks.slice(0, -1),
    })).toThrow(/block census/i);
    expect(() => applyMatrixGenerationRevision(targetValue, candidate, {
      blocks: output.blocks.map((block, index) => (
        index === 1 ? { ...block, targetId: output.blocks[0].targetId } : block
      )),
    })).toThrow(/block census/i);
    expect(() => applyMatrixGenerationRevision(targetValue, candidate, {
      blocks: output.blocks.map((block, index) => index === 0
        ? { ...block, html: `${block.html}<p><a href="https://invented.example">New link</a></p>` }
        : block),
    })).toThrow(/added or changed a link/i);
  });
});
