import { describe, expect, it, vi } from 'vitest';

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
  prepareMatrixGenerationAuditOperation,
  prepareMatrixGenerationRevisionOperation,
  reviseMatrixGenerationCandidate,
  resolveMatrixGenerationRevisionDispatch,
} from '../../server/domains/content/matrix-generation/operations.js';
import {
  parseMatrixGenerationModelAuditAIOutput,
  parseMatrixGenerationRevisionAIOutput,
} from '../../server/domains/content/matrix-generation/output-schemas.js';
import { matrixGenerationProviderReservation } from '../../server/domains/content/matrix-generation/budget.js';
import type { BoundedProviderDispatch } from '../../server/content-posts-ai.js';

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
  const sectionHtml = (index: number, body: string) => (
    `<h2>${sections[index]?.heading.renderedText ?? ''}</h2>${body}`
  );
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
        content: sectionHtml(0, '<p>SEO consulting in Austin starts with a direct review of the pages people use to understand a service. The work focuses on clear priorities, useful explanations, and measurable search improvements for the client.</p>'),
        wordCount: 32,
        targetWordCount: 80,
        keywords: [targetValue.targetKeyword.value],
        status: 'done',
      },
      {
        index: 1,
        heading: sections[1]?.heading.renderedText ?? '',
        content: sectionHtml(1, '<p>What does an SEO consulting engagement include?</p><p>It includes a focused review, an ordered plan, and clear recommendations the client can evaluate before deciding what to implement.</p>'),
        wordCount: 27,
        targetWordCount: 80,
        keywords: [],
        status: 'done',
      },
      {
        index: 2,
        heading: sections[2]?.heading.renderedText ?? '',
        content: sectionHtml(2, '<p>Serving Austin businesses with on-site workshops in the verified downtown service area. <a href="https://example.com/contact">Schedule an SEO consulting conversation</a> when the timing is right.</p>'),
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
    generationProvenance: {
      runId: 'seo-run',
      operation: 'content-post-seo-meta',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      inputFingerprint: 'a'.repeat(64),
      startedAt: NOW,
      completedAt: NOW,
      executions: [
        {
          runId: 'intro-run',
          operation: 'content-post-introduction',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          inputFingerprint: 'b'.repeat(64),
          startedAt: NOW,
          completedAt: NOW,
        },
        {
          runId: 'section-run',
          operation: 'content-post-section',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          inputFingerprint: 'c'.repeat(64),
          startedAt: NOW,
          completedAt: NOW,
        },
      ],
    },
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
  internalPathCensusComplete?: boolean;
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
    internalPathCensusComplete: overrides.internalPathCensusComplete ?? true,
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

  it('does not require a complete internal-path census when the draft has no relative links', () => {
    const candidate = post();
    candidate.sections[2].content = '<h2>Schedule SEO consulting</h2><p><a href="https://external.example/resource">Read an external resource</a>.</p>';

    expect(checkResult(audit({
      post: candidate,
      knownInternalPaths: [],
      internalPathCensusComplete: false,
    }), 'internal-paths')).toBe('passed');

    candidate.sections[2].content = '<p><a href="/contact">Contact us</a>.</p>';
    expect(checkResult(audit({
      post: candidate,
      knownInternalPaths: ['/contact'],
      internalPathCensusComplete: false,
    }), 'internal-paths')).toBe('failed');
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

  it('binds unlocked headings to the generated first H2 while keeping locked headings literal', () => {
    const targetValue = target();
    const candidate = post(targetValue);
    const bodyBlocks = targetValue.blockManifest.blocks.filter(block => block.source === 'template');
    expect(bodyBlocks[2].heading.locked).toBe(false);
    candidate.sections[2].heading = 'A calmer next step';
    candidate.sections[2].content = candidate.sections[2].content.replace(
      /<h2>.*?<\/h2>/,
      '<h2>A calmer next step</h2>',
    );
    expect(checkResult(audit({ target: targetValue, post: candidate }), 'template-block-census'))
      .toBe('passed');

    candidate.sections[0].heading = 'A branded answer';
    candidate.sections[0].content = candidate.sections[0].content.replace(
      /<h2>.*?<\/h2>/,
      '<h2>A branded answer</h2>',
    );
    expect(checkResult(audit({ target: targetValue, post: candidate }), 'template-block-census'))
      .toBe('failed');
  });

  it('accepts exact heading absence for headingless blocks and preserves it through revision', () => {
    const targetValue = target();
    const templateBlocks = targetValue.blockManifest.blocks.filter(block => block.source === 'template');
    for (const block of templateBlocks) {
      block.heading = { level: null, renderedText: null, locked: true };
    }
    const candidate = post(targetValue);
    candidate.sections = candidate.sections.map(section => ({
      ...section,
      heading: '',
      content: section.content.replace(/<h2>.*?<\/h2>/, ''),
    }));
    const headinglessReport = audit({ target: targetValue, post: candidate });
    expect(headinglessReport.verdict).toBe('ready_for_human_review');
    expect(checkResult(headinglessReport, 'template-block-census')).toBe('passed');
    expect(checkResult(headinglessReport, 'keyword-heading-coverage')).toBe('not_applicable');

    const revised = applyMatrixGenerationRevision(targetValue, candidate as never, {
      blocks: targetValue.blockManifest.blocks.map((block, index) => ({
        targetId: block.id,
        html: block.source === 'template'
          ? `<p>SEO consulting in Austin remains grounded and direct in block ${index + 1}.</p>`
          : `<p>Revised grounded block ${index + 1}.</p>`,
      })),
    });
    expect(revised.sections[0].heading).toBe('');
    expect(revised.sections[0].content).not.toContain('<h2');

    candidate.sections[0].heading = 'answer';
    candidate.sections[0].content = '<h2>answer</h2><p>SEO consulting in Austin remains grounded and direct.</p>';
    expect(checkResult(audit({ target: targetValue, post: candidate }), 'template-block-census'))
      .toBe('failed');
    expect(() => applyMatrixGenerationRevision(targetValue, candidate as never, {
      blocks: targetValue.blockManifest.blocks.map((block, index) => ({
        targetId: block.id,
        html: block.id === 'template:answer'
          ? '<h2>answer</h2><p>Leaked internal heading.</p>'
          : block.source === 'template'
            ? `<h2>${block.heading.renderedText}</h2><p>Revised grounded block ${index + 1}.</p>`
            : `<p>Revised grounded block ${index + 1}.</p>`,
      })),
    })).toThrow(/changed or omitted a frozen section heading/i);
  });

  it('requires frozen block-scoped internal anchors and rejects absolute self-links', () => {
    const targetValue = target();
    const cta = targetValue.blockManifest.blocks.find(block => block.id === 'template:cta');
    if (!cta || cta.source !== 'template') throw new Error('Missing CTA block');
    cta.internalLinkContract = { minimum: 1 };
    targetValue.verifiedInternalLinks = [{
      blockId: 'template:cta',
      sourceSectionId: 'cta',
      evidenceRequirementId: 'matrix-cell:cell-1:section:cta',
      minimum: 1,
      links: [{ href: '/about', anchorText: 'Meet the team' }],
    }];
    const candidate = post(targetValue);
    expect(checkResult(audit({ target: targetValue, post: candidate }), 'internal-paths'))
      .toBe('failed');

    candidate.sections[2].content = '<h2>A calmer next step</h2><p><a href="/about">Meet the team</a></p>';
    candidate.sections[2].heading = 'A calmer next step';
    expect(checkResult(audit({ target: targetValue, post: candidate }), 'internal-paths'))
      .toBe('passed');
    expect(checkResult(audit({
      target: targetValue,
      post: candidate,
      knownInternalPaths: [],
      internalPathCensusComplete: false,
    }), 'internal-paths')).toBe('passed');

    candidate.sections[2].content = '<h2>A calmer next step</h2><p><a href="https://example.com/about">Changed anchor</a></p>';
    expect(checkResult(audit({
      target: targetValue,
      post: candidate,
      knownInternalPaths: [],
      internalPathCensusComplete: false,
    }), 'internal-paths')).toBe('failed');
    candidate.sections[0].content += '<p><a href="https://example.com/about">Meet the team</a></p>';
    candidate.sections[2].content = '<h2>A calmer next step</h2><p>No internal destination here.</p>';
    expect(checkResult(audit({
      target: targetValue,
      post: candidate,
      knownInternalPaths: [],
      internalPathCensusComplete: false,
    }), 'internal-paths')).toBe('failed');

    candidate.sections[2].content = '<h2>A calmer next step</h2><p><a href="https://example.com/austin/seo-consulting">Meet the team</a></p>';
    expect(checkResult(audit({ target: targetValue, post: candidate }), 'internal-paths'))
      .toBe('failed');
  });

  it('counts distinct frozen anchors and rejects a frozen anchor in the wrong block', () => {
    const targetValue = target();
    const cta = targetValue.blockManifest.blocks.find(block => block.id === 'template:cta');
    if (!cta || cta.source !== 'template') throw new Error('Missing CTA block');
    cta.internalLinkContract = { minimum: 2 };
    targetValue.verifiedInternalLinks = [{
      blockId: 'template:cta',
      sourceSectionId: 'cta',
      evidenceRequirementId: 'matrix-cell:cell-1:section:cta',
      minimum: 2,
      links: [
        { href: '/about', anchorText: 'Meet the team' },
        { href: '/contact', anchorText: 'Contact the team' },
      ],
    }];
    const candidate = post(targetValue);
    candidate.sections[2].heading = 'A calmer next step';
    candidate.sections[2].content = '<h2>A calmer next step</h2><p><a href="/about">Meet the team</a> or <a href="/about">Meet the team</a>.</p>';
    expect(checkResult(audit({ target: targetValue, post: candidate }), 'internal-paths'))
      .toBe('failed');

    candidate.sections[0].content += '<p><a href="/about">Meet the team</a></p>';
    candidate.sections[2].content = '<h2>A calmer next step</h2><p><a href="/contact">Contact the team</a></p>';
    expect(checkResult(audit({ target: targetValue, post: candidate }), 'internal-paths'))
      .toBe('failed');
  });

  it('requires semantic table markup only for table-designated blocks', () => {
    const targetValue = target();
    const answer = targetValue.blockManifest.blocks.find(block => block.id === 'template:answer');
    if (!answer || answer.source !== 'template') throw new Error('Missing answer block');
    answer.renderAs = 'table';
    const candidate = post(targetValue);
    expect(checkResult(audit({ target: targetValue, post: candidate }), 'semantic-tables'))
      .toBe('failed');
    candidate.sections[0].content = '<h2>SEO consulting in Austin</h2><table><thead><tr><th>Option</th><th>Speed</th></tr></thead><tbody><tr><td>Focused review</td><td>Clear priorities</td></tr></tbody></table>';
    expect(checkResult(audit({ target: targetValue, post: candidate }), 'semantic-tables'))
      .toBe('passed');
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

  it('routes a non-revisionable human-only warning to human review', () => {
    const deterministic = audit();
    const merged = mergeMatrixGenerationAudit({
      target: target(),
      deterministicReport: deterministic,
      modelOutput: {
        revisionRecommended: true,
        findings: [{
          code: 'human_context',
          severity: 'warning',
          message: 'A human should confirm this implication before review.',
          affectedTargetIds: ['template:cta'],
          requiresHumanReview: true,
        }],
      },
    });

    expect(merged.verdict).toBe('ready_for_human_review');
    expect(getMatrixGenerationAuditDisposition(merged, 0, true)).toBe('ready');
  });

  it('keeps an actionable warning in needs attention even without a revision recommendation', () => {
    const deterministic = audit();
    const merged = mergeMatrixGenerationAudit({
      target: target(),
      deterministicReport: deterministic,
      modelOutput: {
        revisionRecommended: false,
        findings: [{
          code: 'voice_violation',
          severity: 'warning',
          message: 'The draft violates an explicit voice requirement.',
          affectedTargetIds: ['template:cta'],
          requiresHumanReview: false,
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
  it('derives automatic revision from homogeneous prose executions, not top-level SEO metadata', () => {
    const candidate = post() as GeneratedPost & { generationProvenance: NonNullable<GeneratedPost['generationProvenance']> };
    expect(resolveMatrixGenerationRevisionDispatch(candidate as never)).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
    });
    const imageCandidate = structuredClone(candidate);
    for (const execution of imageCandidate.generationProvenance.executions ?? []) {
      if (execution.operation.startsWith('content-post-') && execution.operation !== 'content-post-seo-meta') {
        execution.provider = 'openai';
        execution.model = 'gpt-image-2';
      }
    }
    expect(() => resolveMatrixGenerationRevisionDispatch(imageCandidate as never))
      .toThrow(/active provider\/model pair/i);
    candidate.generationProvenance.executions?.push({
      runId: 'mixed-run',
      operation: 'content-post-section',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      inputFingerprint: 'd'.repeat(64),
      startedAt: NOW,
      completedAt: NOW,
    });
    expect(() => resolveMatrixGenerationRevisionDispatch(candidate as never))
      .toThrow(/one active provider\/model pair|cross or infer/i);
  });

  it('dispatches revision on the exact reserved prose provider/model without fallback', async () => {
    const targetValue = target();
    const candidate = post(targetValue);
    const input = {
      workspaceId: 'ws-1',
      target: targetValue,
      post: candidate as never,
      authority: {
        voiceSnapshot: {
          voiceVersion: 1,
          profileRevision: 1,
          voiceDNA: voiceGuardrails as never,
          guardrails: voiceGuardrails,
          contextModifiers: [],
          anchors: [],
        },
        approvedIdentity: [],
        evidenceResolutions: [],
      } as never,
      auditReport: audit(),
      executionChainId: 'same-model-revision',
    };
    const prepared = prepareMatrixGenerationRevisionOperation(input);
    const boundedDispatches: BoundedProviderDispatch[] = [];
    const call = vi.fn(async options => ({
      text: JSON.stringify({
        blocks: targetValue.blockManifest.blocks.map(block => ({
          targetId: block.id,
          html: '<p>Preserved block.</p>',
        })),
      }),
      tokens: { prompt: 1, completion: 1, total: 2 },
      execution: {
        runId: 'revision-run',
        executionChainId: input.executionChainId,
        operation: 'content-matrix-item-revise',
        provider: options.provider,
        model: options.model,
        attempts: 1,
        cacheOutcome: 'bypass',
        startedAt: NOW,
        completedAt: NOW,
        durationMs: 1,
      },
    }));
    await reviseMatrixGenerationCandidate({
      ...input,
      prepared,
      dependencies: { callAI: call as never },
      beforeBoundedProviderDispatch: dispatch => boundedDispatches.push(dispatch),
    });
    expect(call).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      maxRetries: 0,
      timeoutMs: 240_000,
    }));
    expect(call.mock.calls[0][0]).not.toHaveProperty('temperature');
    expect(boundedDispatches).toEqual([
      expect.objectContaining({ provider: 'anthropic', model: 'claude-opus-4-8' }),
    ]);
    expect(matrixGenerationProviderReservation(boundedDispatches[0]).outputTokens).toBe(16_096);
  });
  it('treats leaked evidence mechanics as a revisionable reader-facing contract violation', () => {
    const prepared = prepareMatrixGenerationAuditOperation({
      workspaceId: 'ws-1',
      target: target(),
      post: post(),
      authority: {
        voiceSnapshot: {
          voiceVersion: 1,
          profileRevision: 1,
          voiceDNA: voiceGuardrails as never,
          guardrails: voiceGuardrails,
          contextModifiers: [],
          anchors: [],
        },
        approvedIdentity: [],
        evidenceResolutions: [],
      } as never,
      deterministicReport: audit(),
      executionChainId: 'matrix-reader-contract',
    });

    expect(prepared.system).toContain('Never narrate internal evidence');
    expect(prepared.system).toContain('recommend revision');
    expect(prepared.system).toContain('[NEEDS CLIENT INPUT: ...] placeholders are exempt');
    expect(prepared.system).toContain('Contact details used exactly once in their allowed block are compliant');
    expect(prepared.system).toContain('optional approved amenity');
  });

  it('gives automatic revision the reader contract and exact authorized placeholder census', () => {
    const prepared = prepareMatrixGenerationRevisionOperation({
      workspaceId: 'ws-1',
      target: target(),
      post: post(),
      authority: {
        voiceSnapshot: {
          voiceVersion: 1,
          profileRevision: 1,
          voiceDNA: voiceGuardrails as never,
          guardrails: voiceGuardrails,
          contextModifiers: [],
          anchors: [],
        },
        approvedIdentity: [],
        evidenceResolutions: [],
      } as never,
      auditReport: audit(),
      executionChainId: 'matrix-reader-revision-contract',
    });

    expect(prepared.system).toContain('Never narrate internal evidence');
    expect(prepared.system).toContain('Never create or preserve an unauthorized placeholder');
    expect(prepared.system).toContain('Do not return detached heading fields');
    expect(prepared.system).toContain('locked=true exactly');
    expect(prepared.system).toContain('locked=false blocks');
    expect(JSON.parse(prepared.messages[0].content)).toMatchObject({
      authorizedPlaceholderTokens: [],
    });
  });

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
        html: block.source === 'template'
          ? `<h2>${block.heading.renderedText}</h2><p>Revised grounded block ${index + 1} for SEO consulting in Austin.</p>`
          : `<p>Revised grounded block ${index + 1} for SEO consulting in Austin.</p>`,
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
    const addedLinkRevision = applyMatrixGenerationRevision(targetValue, candidate, {
      blocks: output.blocks.map((block, index) => {
        if (index === 0) {
          return {
            ...block,
            html: `${block.html}<p><a href="https://invented.example">New link</a> and <a href="https://example.com/contact">moved approved link</a></p>`,
          };
        }
        if (index === 3) {
          return {
            ...block,
            html: '<h2>Schedule SEO consulting</h2><p><a href="https://example.com/contact">New same-url CTA</a> before <a href="https://example.com/contact">Schedule an SEO consulting conversation</a></p>',
          };
        }
        return block;
      }),
    });
    expect(addedLinkRevision.introduction).not.toContain('https://invented.example');
    expect(addedLinkRevision.introduction).not.toContain('https://example.com/contact');
    expect(addedLinkRevision.introduction).toContain('New link');
    expect(addedLinkRevision.introduction).toContain('moved approved link');
    expect(addedLinkRevision.sections[2]?.content).toContain('https://example.com/contact');
    expect(addedLinkRevision.sections[2]?.content).toContain('New same-url CTA');
    expect(addedLinkRevision.sections[2]?.content)
      .not.toContain('<a href="https://example.com/contact">New same-url CTA</a>');
    expect(addedLinkRevision.sections[2]?.content)
      .toMatch(/<a href="https:\/\/example\.com\/contact"[^>]*>Schedule an SEO consulting conversation<\/a>/);
  });

  it('preserves an accepted query-string link through revision sanitization', () => {
    const targetValue = target();
    const candidate = post(targetValue);
    candidate.sections[2].content = '<h2>Schedule SEO consulting</h2><p><a href="https://example.com/contact?source=matrix&amp;medium=cta">Contact the team</a>.</p>';
    candidate.sections[2].heading = 'Schedule SEO consulting';
    const revised = applyMatrixGenerationRevision(targetValue, candidate, {
      blocks: targetValue.blockManifest.blocks.map((block, index) => ({
        targetId: block.id,
        html: index === 3
          ? '<h2>Schedule SEO consulting</h2><p><a href="https://example.com/contact?source=matrix&amp;medium=cta">Contact the team</a>.</p>'
          : block.source === 'template'
            ? `<h2>${block.heading.renderedText}</h2><p>Revised grounded block ${index + 1} for SEO consulting in Austin.</p>`
            : `<p>Revised grounded block ${index + 1} for SEO consulting in Austin.</p>`,
      })),
    });

    expect(revised.sections[2]?.content)
      .toContain('https://example.com/contact?source=matrix&amp;medium=cta');
  });
});
