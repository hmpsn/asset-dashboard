import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  ContentBrief,
  ContentMatrix,
  ContentTemplate,
  GeneratedPost,
} from '../../shared/types/content.js';
import type { GenerationProvenance } from '../../shared/types/ai-execution.js';
import type { GenerationEvidenceValue } from '../../shared/types/generation-evidence.js';
import type {
  MatrixGenerationPreviewTarget,
  ResolvedMatrixStructuralTarget,
} from '../../shared/types/matrix-generation.js';
import db from '../../server/db/index.js';
import { createMatrix, getMatrix } from '../../server/content-matrices.js';
import { createTemplate } from '../../server/content-templates.js';
import { getPost, updatePostField } from '../../server/content-posts-db.js';
import { listJobs } from '../../server/jobs.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import {
  approveMatrixPageForPublishReadiness,
} from '../../server/domains/content/matrix-generation/approval-service.js';
import {
  resolveContentMatrixEvidence,
} from '../../server/domains/content/matrix-generation/evidence.js';
import {
  auditMatrixGenerationItem,
} from '../../server/domains/content/matrix-generation/item-audit.js';
import type {
  MatrixGenerationItemAuditDependencies,
} from '../../server/domains/content/matrix-generation/item-audit.js';
import type {
  AuditMatrixGenerationCandidateInput,
  ReviseMatrixGenerationCandidateInput,
} from '../../server/domains/content/matrix-generation/operations.js';
import {
  commitMatrixGenerationDraft,
  createMatrixGenerationRun,
  getPersistedMatrixGenerationRun,
  listMatrixGenerationAttempts,
  listMatrixGenerationItems,
  saveMatrixGenerationSetAuditReport,
  transitionMatrixGenerationItem,
  transitionMatrixGenerationRun,
} from '../../server/domains/content/matrix-generation/repository.js';
import { previewMatrixGeneration } from '../../server/domains/content/matrix-generation/preview.js';
import { finalizeBrandVoice } from '../../server/domains/brand/voice-finalization.js';
import {
  addVoiceSample,
  createVoiceProfile,
  getVoiceProfile,
} from '../../server/voice-calibration.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { countHtmlWords } from '../../server/content-posts-ai.js';

const cleanupWorkspaceIds = new Set<string>();

afterEach(() => {
  for (const workspaceId of cleanupWorkspaceIds) {
    setWorkspaceFlagOverride('content-matrix-generation', workspaceId, null);
    deleteWorkspace(workspaceId);
  }
  cleanupWorkspaceIds.clear();
});

interface Fixture {
  workspaceId: string;
  template: ContentTemplate;
  matrix: ContentMatrix;
}

function createFixture(candidateCount = 1): Fixture {
  const workspaceId = createWorkspace(`M2 matrix audit ${randomUUID()}`).id;
  cleanupWorkspaceIds.add(workspaceId);
  setWorkspaceFlagOverride('content-matrix-generation', workspaceId, true);
  const template = createTemplate(workspaceId, {
    name: 'Audited service template',
    pageType: 'service',
    variables: [
      { name: 'service', label: 'Service' },
      { name: 'city', label: 'City' },
    ],
    sections: [
      {
        id: 'body',
        name: 'Service details',
        headingTemplate: '{service} in {city}',
        guidance: 'Explain the verified service clearly.',
        wordCountTarget: 150,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      },
      {
        id: 'cta',
        name: 'Next step',
        headingTemplate: 'Discuss {service}',
        guidance: 'Give the reader one clear next step.',
        wordCountTarget: 50,
        order: 1,
        generationRole: 'cta',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'primary', required: true },
      },
    ],
    urlPattern: '/{city}/{service}',
    keywordPattern: '{service} {city}',
    titlePattern: '{service} in {city}',
    metaDescPattern: 'Practical {service} for {city} organizations.',
    generationContractVersion: 1,
  });
  const matrix = createMatrix(workspaceId, {
    name: 'Service by city',
    templateId: template.id,
    dimensions: [
      { variableName: 'service', values: ['SEO consulting'] },
      {
        variableName: 'city',
        values: Array.from({ length: candidateCount }, (_, index) => (
          index === 0 ? 'Austin' : `Austin ${index + 1}`
        )),
      },
    ],
    urlPattern: template.urlPattern,
    keywordPattern: template.keywordPattern,
  }, { validateTemplate: true });
  return { workspaceId, template, matrix };
}

function seedBrandAuthority(workspaceId: string): void {
  createVoiceProfile(workspaceId);
  const sample = addVoiceSample(
    workspaceId,
    'We explain the useful truth clearly, then let the client decide.',
    'body',
    'manual',
  );
  const profile = getVoiceProfile(workspaceId)!;
  const operator = {
    actorType: 'operator' as const,
    actorId: 'matrix-audit-operator',
  };
  finalizeBrandVoice({
    workspaceId,
    expectedProfileRevision: profile.revision,
    voiceDNA: {
      personalityTraits: ['Clear', 'Calm'],
      toneSpectrum: { formal_casual: 5, serious_playful: 3, technical_accessible: 8 },
      sentenceStyle: 'Short, direct sentences.',
      vocabularyLevel: 'Plain language.',
    },
    guardrails: {
      forbiddenWords: ['guaranteed'],
      requiredTerminology: [],
      toneBoundaries: ['Never pressure the reader.'],
      antiPatterns: ['Unsupported superlatives'],
    },
    contextModifiers: [],
    anchorSelectors: [{ kind: 'voice_sample', voiceSampleId: sample.id }],
    calibrationSelections: [],
    idempotencyKey: `voice-${randomUUID()}`,
    finalizedBy: operator,
    executionActor: operator,
  });

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO brand_identity_deliverables (
      id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at
    ) VALUES (?, ?, 'messaging_pillars', ?, 'approved', 1, 'professional', ?, ?)
  `).run(
    `identity_${randomUUID()}`,
    workspaceId,
    'Clarity before complexity. Ground every recommendation in evidence.',
    now,
    now,
  );
}

function sourceRevision(fixture: Fixture) {
  const matrix = getMatrix(fixture.workspaceId, fixture.matrix.id)!;
  const cell = matrix.cells[0];
  return {
    matrixRevision: matrix.revision ?? 0,
    templateRevision: fixture.template.revision ?? 0,
    cellRevision: cell.revision ?? 0,
  };
}

async function preview(fixture: Fixture) {
  return previewMatrixGeneration({
    workspaceId: fixture.workspaceId,
    matrixId: fixture.matrix.id,
    selections: [{
      cellId: fixture.matrix.cells[0].id,
      expectedSourceRevision: sourceRevision(fixture),
    }],
  });
}

async function resolveEvidence(
  fixture: Fixture,
  requirementId: string,
  value: GenerationEvidenceValue,
): Promise<void> {
  const result = (await preview(fixture)).results[0];
  if (!result) throw new Error('Missing preview result');
  await resolveContentMatrixEvidence({
    workspaceId: fixture.workspaceId,
    matrixId: fixture.matrix.id,
    cellId: fixture.matrix.cells[0].id,
    requirementId,
    value,
    sourceRef: {
      sourceType: 'operator_attestation',
      sourceId: `attestation-${requirementId}`,
      capturedAt: new Date().toISOString(),
    },
    resolvedBy: { actorType: 'operator', actorId: 'matrix-audit-operator' },
    expectedSourceRevision: sourceRevision(fixture),
    expectedArtifactRevisions: result.status === 'ready'
      ? result.target.expectedArtifactRevisions
      : result.expectedArtifactRevisions,
    idempotencyKey: `evidence-${requirementId}-${randomUUID()}`,
  });
}

function structuralTarget(target: MatrixGenerationPreviewTarget): ResolvedMatrixStructuralTarget {
  const {
    voiceSnapshot: _voiceSnapshot,
    identitySnapshot: _identitySnapshot,
    evidenceRequirements: _evidenceRequirements,
    evidenceCapturedAt: _evidenceCapturedAt,
    evidenceFreshThrough: _evidenceFreshThrough,
    expectedArtifactRevisions: _expectedArtifactRevisions,
    effectiveInputFingerprint: _effectiveInputFingerprint,
    blockingRequirementIds: _blockingRequirementIds,
    frozenEvidenceResolutionIds: _frozenEvidenceResolutionIds,
    estimatedPaidBudget: _estimatedPaidBudget,
    ...resolved
  } = target;
  return resolved;
}

function provenance(operation: string, inputFingerprint = 'a'.repeat(64)): GenerationProvenance {
  const timestamp = new Date().toISOString();
  return {
    runId: `${operation}-${randomUUID()}`,
    executionChainId: 'matrix-audit-chain',
    operation,
    provider: 'openai',
    model: 'gpt-5.6-terra',
    inputFingerprint,
    startedAt: timestamp,
    completedAt: timestamp,
  };
}

function postProvenance(): GenerationProvenance {
  const timestamp = new Date().toISOString();
  const accepted = provenance('content-post-seo-meta');
  return {
    ...accepted,
    executions: [...['content-post-introduction', 'content-post-section', 'content-post-conclusion']
      .map(operation => ({
        runId: `${operation}-${randomUUID()}`,
        executionChainId: 'matrix-audit-chain',
        operation,
        provider: 'openai' as const,
        model: 'gpt-5.6-terra',
        inputFingerprint: 'b'.repeat(64),
        startedAt: timestamp,
        completedAt: timestamp,
      })), {
        runId: accepted.runId,
        executionChainId: accepted.executionChainId,
        operation: accepted.operation,
        provider: accepted.provider,
        model: accepted.model,
        inputFingerprint: accepted.inputFingerprint,
        startedAt: accepted.startedAt,
        completedAt: accepted.completedAt,
      }],
  };
}

function candidates(
  workspaceId: string,
  target: MatrixGenerationPreviewTarget,
): { brief: ContentBrief; post: GeneratedPost } {
  const now = new Date().toISOString();
  const templateBlocks = target.blockManifest.blocks.filter(block => block.source === 'template');
  const unresolvedCta = target.evidenceRequirements.find(requirement => (
    requirement.fieldPath === 'cta.details' && requirement.status === 'missing'
  ));
  const placeholder = unresolvedCta
    ? `[NEEDS CLIENT INPUT: ${unresolvedCta.clientSafePrompt ?? unresolvedCta.reason}]`
    : '';
  const briefId = `brief_${randomUUID()}`;
  const introduction = '<p>SEO consulting in Austin gives organizations a calm, practical path to clearer search priorities and useful decisions without inflated promises.</p>';
  const sectionBody = `<h2>${templateBlocks[0].heading.renderedText}</h2><p>SEO consulting in Austin starts with a focused review of the pages people use to understand the organization. The client receives clear priorities, direct explanations, and a practical sequence for deciding what should change first.</p><p>${Array.from({ length: 70 }, () => 'strategy').join(' ')}</p>`;
  const sectionCta = placeholder
    ? `<h2>${templateBlocks[1].heading.renderedText}</h2><p>Contact the team to discuss SEO consulting when the timing is right. ${placeholder}</p><p>${Array.from({ length: 70 }, () => 'action').join(' ')}</p>`
    : `<h2>${templateBlocks[1].heading.renderedText}</h2><p><a href="https://example.com/contact">Contact the team</a> to discuss SEO consulting when the timing is right.</p><p>${Array.from({ length: 70 }, () => 'action').join(' ')}</p>`;
  const conclusion = '<h2>Next</h2><p>Review the priorities, ask questions, and choose the next step that makes sense.</p>';
  const sectionBodyWords = countHtmlWords(sectionBody);
  const sectionCtaWords = countHtmlWords(sectionCta);
  return {
    brief: {
      id: briefId,
      workspaceId,
      targetKeyword: target.targetKeyword.value,
      secondaryKeywords: [],
      suggestedTitle: target.title,
      suggestedMetaDesc: target.metaDescription,
      outline: templateBlocks.map(block => ({
        heading: block.heading.renderedText ?? block.id,
        notes: block.guidance,
        wordCount: block.wordCountTarget,
      })),
      wordCountTarget: target.blockManifest.totalWordCountTarget,
      intent: 'commercial',
      audience: 'Austin organizations',
      competitorInsights: '',
      internalLinkSuggestions: [],
      pageType: target.pageType,
      keywordLocked: true,
      keywordSource: 'matrix',
      templateId: target.templateId,
      generationProvenance: provenance('content-brief-generate'),
      createdAt: now,
    },
    post: {
      id: `post_${randomUUID()}`,
      workspaceId,
      briefId,
      targetKeyword: target.targetKeyword.value,
      title: target.title,
      metaDescription: target.metaDescription,
      seoTitle: target.title,
      seoMetaDescription: target.metaDescription,
      introduction,
      sections: [
        {
          index: 0,
          heading: templateBlocks[0].heading.renderedText ?? '',
          content: sectionBody,
          wordCount: sectionBodyWords,
          targetWordCount: 150,
          keywords: [target.targetKeyword.value],
          status: 'done',
        },
        {
          index: 1,
          heading: templateBlocks[1].heading.renderedText ?? '',
          content: sectionCta,
          wordCount: sectionCtaWords,
          targetWordCount: 50,
          keywords: [],
          status: 'done',
        },
      ],
      conclusion,
      totalWordCount: countHtmlWords(introduction)
        + sectionBodyWords
        + sectionCtaWords
        + countHtmlWords(conclusion),
      targetWordCount: target.blockManifest.totalWordCountTarget,
      status: 'draft',
      generationProvenance: postProvenance(),
      createdAt: now,
      updatedAt: now,
    },
  };
}

async function committedFixture(
  resolveCta: boolean,
  mutatePost?: (post: GeneratedPost) => void,
  candidateCount = 1,
) {
  const fixture = createFixture(candidateCount);
  seedBrandAuthority(fixture.workspaceId);
  const cellId = fixture.matrix.cells[0].id;
  await resolveEvidence(
    fixture,
    `matrix-cell:${cellId}:service-availability`,
    { kind: 'boolean', value: true },
  );
  await resolveEvidence(
    fixture,
    `matrix-cell:${cellId}:service-details`,
    {
      kind: 'text_list',
      value: [
        'The service starts with a focused review of the organization’s current search priorities.',
        'The team explains the findings in plain language and answers questions before recommending work.',
        'The client receives a practical sequence of next steps grounded in the completed review.',
      ],
    },
  );
  if (resolveCta) {
    await resolveEvidence(
      fixture,
      `matrix-cell:${cellId}:cta-details`,
      { kind: 'url', value: 'https://example.com/contact' },
    );
  }
  const ready = (await preview(fixture)).results[0];
  if (!ready || ready.status !== 'ready') throw new Error('Expected a ready target');
  const target = ready.target;
  const selection = {
    matrixId: target.matrixId,
    cellId: target.cellId,
    sourceRevision: target.sourceRevision,
    structuralFingerprint: target.structuralFingerprint,
    previewFingerprint: target.effectiveInputFingerprint,
  };
  let run = createMatrixGenerationRun({
    workspaceId: fixture.workspaceId,
    matrixId: fixture.matrix.id,
    templateId: fixture.template.id,
    idempotencyKey: `run-${randomUUID()}`,
    selectionFingerprint: target.effectiveInputFingerprint,
    selections: [
      selection,
      ...fixture.matrix.cells.slice(1).map(cell => ({
        ...selection,
        cellId: cell.id,
        sourceRevision: {
          ...selection.sourceRevision,
          cellRevision: cell.revision ?? 0,
        },
      })),
    ],
    createdBy: { actorType: 'operator', actorId: 'matrix-audit-operator' },
    mcpExecutionContext: null,
  }).run;
  let item = listMatrixGenerationItems(fixture.workspaceId, run.id)[0];
  item = transitionMatrixGenerationItem({
    workspaceId: fixture.workspaceId,
    itemId: item.id,
    expectedRevision: item.revision,
    nextStatus: 'preflighting',
    structuralTarget: structuralTarget(target),
    previewTarget: target,
  });
  item = transitionMatrixGenerationItem({
    workspaceId: fixture.workspaceId,
    itemId: item.id,
    expectedRevision: item.revision,
    nextStatus: 'preflighted',
  });
  item = transitionMatrixGenerationItem({
    workspaceId: fixture.workspaceId,
    itemId: item.id,
    expectedRevision: item.revision,
    nextStatus: 'generating_brief',
  });
  run = transitionMatrixGenerationRun({
    workspaceId: fixture.workspaceId,
    runId: run.id,
    expectedRevision: run.revision,
    nextStatus: 'running',
  });
  item = transitionMatrixGenerationItem({
    workspaceId: fixture.workspaceId,
    itemId: item.id,
    expectedRevision: item.revision,
    nextStatus: 'generating_post',
  });
  const generated = candidates(fixture.workspaceId, target);
  mutatePost?.(generated.post);
  const committed = commitMatrixGenerationDraft({
    workspaceId: fixture.workspaceId,
    itemId: item.id,
    expectedItemRevision: item.revision,
    target,
    ...generated,
  });
  return { fixture, target, ...committed };
}

function operationResult<T>(
  input: AuditMatrixGenerationCandidateInput | ReviseMatrixGenerationCandidateInput,
  operation: 'content-matrix-item-audit' | 'content-matrix-item-revise',
  output: T,
) {
  const fingerprint = input.prepared?.effectiveInputFingerprint;
  if (!fingerprint) throw new Error('Expected a prepared operation');
  const generationProvenance = provenance(operation, fingerprint);
  const timestamp = generationProvenance.startedAt;
  return {
    output,
    provenance: generationProvenance,
    effectiveInputFingerprint: fingerprint,
    tokens: { prompt: 100, completion: 100, total: 200 },
    execution: {
      runId: generationProvenance.runId,
      executionChainId: input.executionChainId,
      operation,
      provider: 'openai' as const,
      model: 'gpt-5.6-terra',
      attempts: 1,
      cacheOutcome: 'bypass' as const,
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 1,
    },
  };
}

function revisedBlocks(input: ReviseMatrixGenerationCandidateInput) {
  let templateIndex = 0;
  return input.target.blockManifest.blocks.map(block => {
    if (block.source === 'system' && block.generationRole === 'introduction') {
      return { targetId: block.id, html: input.post.introduction };
    }
    if (block.source === 'system' && block.generationRole === 'conclusion') {
      return { targetId: block.id, html: input.post.conclusion };
    }
    const section = input.post.sections[templateIndex];
    templateIndex += 1;
    return {
      targetId: block.id,
      html: block.generationRole === 'body'
        ? `${section.content}<p>The revised explanation keeps the client focused on useful evidence and a practical order of operations.</p>`
        : section.content,
    };
  });
}

describe('auditMatrixGenerationItem', () => {
  it('audits the exact preview-frozen evidence row after a newer value supersedes it', async () => {
    const committed = await committedFixture(true);
    const frozenIds = committed.target.frozenEvidenceResolutionIds;
    const supersededId = frozenIds[0];
    if (!supersededId) throw new Error('Expected frozen evidence');
    const replacementId = `mce_${randomUUID()}`;
    const supersededAt = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`
        UPDATE content_matrix_cell_evidence
        SET is_current = 0, superseded_at = ?
        WHERE id = ? AND workspace_id = ?
      `).run(supersededAt, supersededId, committed.fixture.workspaceId);
      db.prepare(`
        INSERT INTO content_matrix_cell_evidence (
          id, workspace_id, matrix_id, cell_id, requirement_id,
          matrix_revision, template_revision, cell_revision,
          value, source_ref, resolved_by, expected_artifact_revisions,
          idempotency_key, supersedes_id, is_current, created_at, superseded_at
        )
        SELECT
          ?, workspace_id, matrix_id, cell_id, requirement_id,
          matrix_revision, template_revision, cell_revision,
          value, source_ref, resolved_by, expected_artifact_revisions,
          ?, id, 1, ?, NULL
        FROM content_matrix_cell_evidence
        WHERE id = ? AND workspace_id = ?
      `).run(
        replacementId,
        `replacement-${randomUUID()}`,
        supersededAt,
        supersededId,
        committed.fixture.workspaceId,
      );
    }).immediate();

    let auditedEvidenceIds: string[] = [];
    const result = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId: 'matrix-frozen-evidence-audit-chain',
    }, {
      buildKnownPageCensus: async () => ({ paths: [], complete: true }),
      auditCandidate: async input => {
        auditedEvidenceIds = input.authority.evidenceResolutions.map(item => item.id);
        return operationResult(
          input,
          'content-matrix-item-audit',
          { revisionRecommended: false, findings: [] },
        );
      },
    });

    expect(result.item.status).toBe('ready_for_human_review');
    expect(auditedEvidenceIds).toEqual(frozenIds);
    expect(auditedEvidenceIds).toContain(supersededId);
    expect(auditedEvidenceIds).not.toContain(replacementId);
  });

  it('allows a one-cell run to reach human approval without a set audit and never queues publication', async () => {
    const committed = await committedFixture(true);
    const audited = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId: 'matrix-single-approval-chain',
    }, {
      buildKnownPageCensus: async () => ({ paths: [], complete: true }),
      auditCandidate: async input => operationResult(
        input,
        'content-matrix-item-audit',
        { revisionRecommended: false, findings: [] },
      ),
    });
    const run = getPersistedMatrixGenerationRun(
      committed.fixture.workspaceId,
      audited.item.runId,
    )!;
    expect(run.selections).toHaveLength(1);
    expect(run.setAuditReport).toBeNull();
    const publishJobsBefore = listJobs(committed.fixture.workspaceId)
      .filter(job => job.type === 'content-publish').length;

    const approved = approveMatrixPageForPublishReadiness({
      workspaceId: committed.fixture.workspaceId,
      runId: run.id,
      itemId: audited.item.id,
      expectedRunRevision: run.revision,
      expectedItemRevision: audited.item.revision,
      expectedPostRevision: audited.post.generationRevision,
      approvedBy: { actorType: 'operator', actorId: 'matrix-approver' },
    });

    expect(approved.item.approvalEvidence).toMatchObject({
      postId: audited.post.id,
      approvedBy: { actorType: 'operator', actorId: 'matrix-approver' },
    });
    expect(listJobs(committed.fixture.workspaceId)
      .filter(job => job.type === 'content-publish')).toHaveLength(publishJobsBefore);
  });

  it('requires a nonblocking set audit before human approval for a multi-cell run', async () => {
    const committed = await committedFixture(true, undefined, 2);
    const audited = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId: 'matrix-approval-chain',
    }, {
      buildKnownPageCensus: async () => ({ paths: [], complete: true }),
      auditCandidate: async input => operationResult(
        input,
        'content-matrix-item-audit',
        { revisionRecommended: false, findings: [] },
      ),
    });
    const runBeforeSetAudit = getPersistedMatrixGenerationRun(
      committed.fixture.workspaceId,
      audited.item.runId,
    )!;
    const approvalRequest = {
      workspaceId: committed.fixture.workspaceId,
      runId: runBeforeSetAudit.id,
      itemId: audited.item.id,
      expectedRunRevision: runBeforeSetAudit.revision,
      expectedItemRevision: audited.item.revision,
      expectedPostRevision: audited.post.generationRevision,
      approvedBy: { actorType: 'operator' as const, actorId: 'matrix-approver' },
    };

    expect(() => approveMatrixPageForPublishReadiness(approvalRequest)).toThrow(
      /not ready for human approval/i,
    );

    const run = saveMatrixGenerationSetAuditReport({
      workspaceId: committed.fixture.workspaceId,
      runId: runBeforeSetAudit.id,
      expectedRunRevision: runBeforeSetAudit.revision,
      report: {
        verdict: 'passed',
        findings: [{
          id: 'mgsf-human-review',
          source: 'model',
          kind: 'provenance',
          code: 'human_fact_check',
          severity: 'warning',
          message: 'A human should confirm this factual implication.',
          affectedItemIds: [audited.item.id],
          affectedTargetIds: [],
          requiresHumanReview: true,
        }],
        passCount: 1,
        modelProvenance: provenance('content-matrix-set-audit'),
        auditedAt: new Date().toISOString(),
      },
    });
    const publishJobsBefore = listJobs(committed.fixture.workspaceId)
      .filter(job => job.type === 'content-publish').length;
    const approved = approveMatrixPageForPublishReadiness({
      ...approvalRequest,
      expectedRunRevision: run.revision,
    });

    expect(approved.item.approvalEvidence).toMatchObject({
      postId: audited.post.id,
      approvedBy: { actorType: 'operator', actorId: 'matrix-approver' },
    });
    expect(getPost(committed.fixture.workspaceId, audited.post.id)?.status).toBe('approved');
    expect(getMatrix(committed.fixture.workspaceId, committed.fixture.matrix.id)?.cells[0].status)
      .toBe('approved');
    expect(listJobs(committed.fixture.workspaceId)
      .filter(job => job.type === 'content-publish')).toHaveLength(publishJobsBefore);
  });

  it('persists exactly one revision, re-audits it, and exposes every paid call provenance', async () => {
    const committed = await committedFixture(true);
    let auditCalls = 0;
    let revisionCalls = 0;
    const overrides: Partial<MatrixGenerationItemAuditDependencies> = {
      buildKnownPageCensus: async () => ({ paths: [], complete: true }),
      auditCandidate: async input => {
        auditCalls += 1;
        return operationResult(
          input,
          'content-matrix-item-audit',
          auditCalls === 1
            ? {
                revisionRecommended: true,
                findings: [{
                  code: 'voice_specificity',
                  severity: 'warning' as const,
                  message: 'Make the service explanation more specific without adding facts.',
                  affectedTargetIds: ['template:body'],
                  requiresHumanReview: false,
                }],
              }
            : { revisionRecommended: false, findings: [] },
        );
      },
      reviseCandidate: async input => {
        revisionCalls += 1;
        return operationResult(
          input,
          'content-matrix-item-revise',
          { blocks: revisedBlocks(input) },
        );
      },
    };

    const result = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId: 'matrix-audit-chain',
    }, overrides);

    expect(result.item).toMatchObject({
      status: 'ready_for_human_review',
      automaticRevisionCount: 1,
    });
    expect(result.item.auditReport).toMatchObject({
      verdict: 'ready_for_human_review',
      revisionCount: 1,
      modelFindings: [],
      humanRequiredChecks: expect.arrayContaining([
        expect.objectContaining({ id: 'factual-accuracy', result: 'needs_human_review' }),
        expect.objectContaining({ id: 'no-hallucinations', result: 'needs_human_review' }),
      ]),
    });
    expect(result.providerCalls).toBe(3);
    expect(result.automaticRevisionApplied).toBe(true);
    expect(auditCalls).toBe(2);
    expect(revisionCalls).toBe(1);
    const durablePost = getPost(committed.fixture.workspaceId, committed.post.id);
    expect(durablePost?.generationRevision).toBe(2);
    expect(durablePost?.sections.length).toBeGreaterThan(0);
    expect(durablePost?.sections.every(section => ( // every-ok -- guarded by the non-empty assertion above
      section.wordCount === countHtmlWords(section.content)
    ))).toBe(true);
    expect(durablePost?.totalWordCount).toBe(
      countHtmlWords(durablePost?.introduction ?? '')
        + (durablePost?.sections.reduce((sum, section) => sum + countHtmlWords(section.content), 0) ?? 0)
        + countHtmlWords(durablePost?.conclusion ?? ''),
    );
    expect(result.item.auditReport?.deterministicChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'word-count-integrity', result: 'passed' }),
      expect.objectContaining({ id: 'word-count-target', result: 'passed' }),
    ]));

    const attempts = listMatrixGenerationAttempts(
      committed.fixture.workspaceId,
      committed.item.id,
    );
    expect(attempts.map(attempt => attempt.stage)).toEqual([
      'deterministic_audit',
      'model_audit',
      'revision',
      'deterministic_audit',
      'model_audit',
    ]);
    const paidAttempts = attempts.filter(attempt => attempt.provenance !== null);
    expect(paidAttempts).toHaveLength(3);
    expect(paidAttempts.length).toBeGreaterThan(0);
    expect(paidAttempts.every(attempt => ( // every-ok -- non-empty asserted above
      attempt.effectiveInputFingerprint === attempt.provenance?.inputFingerprint
    ))).toBe(true);

    await expect(auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: result.item.revision,
      expectedPostRevision: result.post.generationRevision,
      executionChainId: 'matrix-audit-chain',
    }, overrides)).rejects.toThrow(/changed since it was read/i);
    expect(auditCalls).toBe(2);
    expect(revisionCalls).toBe(1);
  });

  it('stops after one revision when the final body remains outside the accepted target band', async () => {
    const committed = await committedFixture(true);
    let auditCalls = 0;
    let revisionCalls = 0;
    const result = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId: 'matrix-word-target-revision-chain',
    }, {
      buildKnownPageCensus: async () => ({ paths: [], complete: true }),
      auditCandidate: async input => {
        auditCalls += 1;
        return operationResult(input, 'content-matrix-item-audit', {
          revisionRecommended: true,
          findings: [{
            code: 'voice_specificity',
            severity: 'warning' as const,
            message: 'Tighten the explanation without changing facts.',
            affectedTargetIds: ['template:body'],
            requiresHumanReview: false,
          }],
        });
      },
      reviseCandidate: async input => {
        revisionCalls += 1;
        const blocks = revisedBlocks(input);
        const body = blocks.find(block => block.targetId === 'template:body');
        if (!body) throw new Error('Expected body block');
        body.html = '<h2>SEO consulting in Austin</h2><p>Clear priorities for the client.</p>';
        return operationResult(input, 'content-matrix-item-revise', { blocks });
      },
    });

    expect(result.item).toMatchObject({
      status: 'needs_attention',
      automaticRevisionCount: 1,
      auditReport: {
        verdict: 'needs_attention',
        deterministicChecks: expect.arrayContaining([
          expect.objectContaining({ id: 'word-count-target', result: 'failed' }),
        ]),
      },
    });
    expect(result.providerCalls).toBe(2);
    expect(result.automaticRevisionApplied).toBe(true);
    expect(auditCalls).toBe(1);
    expect(revisionCalls).toBe(1);
    expect(result.post.sections.length).toBeGreaterThan(0);
    expect(result.post.sections.every(section => ( // every-ok -- guarded by the non-empty assertion above
      section.wordCount === countHtmlWords(section.content)
    ))).toBe(true);
  });

  it('preserves the accepted artifact when automatic revision returns multiple H2s', async () => {
    const committed = await committedFixture(true);
    const acceptedContent = committed.post.sections[0].content;
    const result = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId: 'matrix-heading-regression-chain',
    }, {
      buildKnownPageCensus: async () => ({ paths: [], complete: true }),
      auditCandidate: async input => operationResult(input, 'content-matrix-item-audit', {
        revisionRecommended: true,
        findings: [{
          code: 'voice_specificity',
          severity: 'warning' as const,
          message: 'Make the service explanation more specific without adding facts.',
          affectedTargetIds: ['template:body'],
          requiresHumanReview: false,
        }],
      }),
      reviseCandidate: async input => {
        const blocks = revisedBlocks(input);
        const body = blocks.find(block => block.targetId === 'template:body');
        if (!body) throw new Error('Expected body block');
        body.html += '<h2>Unexpected duplicate heading</h2>';
        return operationResult(input, 'content-matrix-item-revise', { blocks });
      },
    });

    expect(result.item).toMatchObject({
      status: 'needs_attention',
      automaticRevisionCount: 0,
      error: { code: 'matrix_generation_revision_failed', retryable: true },
    });
    expect(result.automaticRevisionApplied).toBe(false);
    expect(result.providerCalls).toBe(2);
    const durablePost = getPost(committed.fixture.workspaceId, committed.post.id);
    expect(durablePost?.generationRevision).toBe(committed.post.generationRevision);
    expect(durablePost?.sections[0].content).toBe(acceptedContent);
    expect(listMatrixGenerationAttempts(
      committed.fixture.workspaceId,
      committed.item.id,
    ).at(-1)).toMatchObject({ stage: 'revision', status: 'failed' });
  });

  it('routes a human-only model finding to review without automatic revision', async () => {
    const committed = await committedFixture(true);
    let revisionCalls = 0;
    const result = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId: 'matrix-audit-chain',
    }, {
      buildKnownPageCensus: async () => ({ paths: [], complete: true }),
      auditCandidate: async input => operationResult(input, 'content-matrix-item-audit', {
        revisionRecommended: false,
        findings: [{
          code: 'human_context',
          severity: 'warning' as const,
          message: 'A human should confirm this implication.',
          affectedTargetIds: ['template:cta'],
          requiresHumanReview: true,
        }],
      }),
      reviseCandidate: async () => {
        revisionCalls += 1;
        throw new Error('Revision should not run');
      },
    });

    expect(result.item).toMatchObject({
      status: 'ready_for_human_review',
      automaticRevisionCount: 0,
      auditReport: { verdict: 'ready_for_human_review' },
    });
    expect(result.providerCalls).toBe(1);
    expect(result.automaticRevisionApplied).toBe(false);
    expect(revisionCalls).toBe(0);
  });

  it('fails closed before revision spend when accepted prose provenance is mixed', async () => {
    const committed = await committedFixture(true, candidate => {
      candidate.generationProvenance?.executions?.push({
        runId: `mixed-${randomUUID()}`,
        executionChainId: 'matrix-audit-chain',
        operation: 'content-post-section',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        inputFingerprint: 'c'.repeat(64),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
    });
    let revisionCalls = 0;
    const result = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
    }, {
      buildKnownPageCensus: async () => ({ paths: [], complete: true }),
      auditCandidate: async input => operationResult(
        input,
        'content-matrix-item-audit',
        {
          revisionRecommended: true,
          findings: [{
            code: 'person_drift',
            severity: 'warning' as const,
            message: 'The draft shifted out of its direct-reader register.',
            affectedTargetIds: ['template:body'],
            requiresHumanReview: false,
          }],
        },
      ),
      reviseCandidate: async () => {
        revisionCalls += 1;
        throw new Error('Revision must not run');
      },
    });

    expect(result.item.status).toBe('needs_attention');
    expect(result.item.error?.code).toBe('matrix_generation_revision_provenance_unavailable');
    expect(result.item.auditReport?.modelFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'revision_provenance_unavailable' }),
    ]));
    expect(result.providerCalls).toBe(1);
    expect(revisionCalls).toBe(0);
    expect(listMatrixGenerationAttempts(
      committed.fixture.workspaceId,
      committed.item.id,
    ).map(attempt => attempt.stage)).not.toContain('revision');
  });

  it('continues model audit with an incomplete page census when there are no relative links', async () => {
    const committed = await committedFixture(true);
    let auditCalls = 0;
    const result = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId: 'matrix-audit-chain',
    }, {
      buildKnownPageCensus: async () => ({ paths: [], complete: false }),
      auditCandidate: async input => {
        auditCalls += 1;
        return operationResult(input, 'content-matrix-item-audit', {
          revisionRecommended: false,
          findings: [],
        });
      },
    });

    expect(result.item.status).toBe('ready_for_human_review');
    expect(auditCalls).toBe(1);
  });

  it('blocks an unresolved ready-stage fact before model audit or revision spend', async () => {
    const committed = await committedFixture(false);
    let paidCalls = 0;
    const neverCall = async () => {
      paidCalls += 1;
      throw new Error('Paid operation should not run');
    };
    const result = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId: 'matrix-audit-chain',
    }, {
      buildKnownPageCensus: async () => ({ paths: [], complete: true }),
      auditCandidate: neverCall,
      reviseCandidate: neverCall,
    });

    expect(result.item.status).toBe('blocked_missing_evidence');
    expect(result.item.auditReport).toMatchObject({
      verdict: 'blocked_missing_evidence',
      unresolvedRequirementIds: [`matrix-cell:${committed.target.cellId}:cta-details`],
      revisionCount: 0,
    });
    expect(result.providerCalls).toBe(0);
    expect(result.automaticRevisionApplied).toBe(false);
    expect(paidCalls).toBe(0);
    expect(listMatrixGenerationAttempts(
      committed.fixture.workspaceId,
      committed.item.id,
    ).map(attempt => attempt.stage)).toEqual(['deterministic_audit']);
  });

  it('stops after a revision regression instead of spending on another model audit', async () => {
    const committed = await committedFixture(true);
    let auditCalls = 0;
    let revisionCalls = 0;
    const result = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId: 'matrix-audit-chain',
    }, {
      buildKnownPageCensus: async () => ({ paths: [], complete: true }),
      auditCandidate: async input => {
        auditCalls += 1;
        return operationResult(input, 'content-matrix-item-audit', {
          revisionRecommended: true,
          findings: [{
            code: 'coherence',
            severity: 'warning' as const,
            message: 'Revise the opening.',
            affectedTargetIds: ['system:introduction'],
            requiresHumanReview: false,
          }],
        });
      },
      reviseCandidate: async input => {
        revisionCalls += 1;
        const blocks = revisedBlocks(input);
        blocks[0] = { targetId: blocks[0].targetId, html: '<p>Clear service.</p>' };
        return operationResult(input, 'content-matrix-item-revise', { blocks });
      },
    });

    expect(result.item).toMatchObject({
      status: 'needs_attention',
      automaticRevisionCount: 1,
      auditReport: {
        verdict: 'needs_attention',
        revisionCount: 1,
      },
    });
    expect(result.providerCalls).toBe(2);
    expect(auditCalls).toBe(1);
    expect(revisionCalls).toBe(1);
    expect(result.item.auditReport?.deterministicChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'keyword-introduction-coverage', result: 'failed' }),
    ]));
  });

  it('never overwrites an operator edit that lands while automatic revision is running', async () => {
    const committed = await committedFixture(true);
    const manualIntroduction = '<p>Operator-authored introduction that must survive.</p>';
    const result = await auditMatrixGenerationItem({
      workspaceId: committed.fixture.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId: 'matrix-audit-chain',
    }, {
      buildKnownPageCensus: async () => ({ paths: [], complete: true }),
      auditCandidate: async input => operationResult(input, 'content-matrix-item-audit', {
        revisionRecommended: true,
        findings: [{
          code: 'voice_specificity',
          severity: 'warning' as const,
          message: 'Revise the voice.',
          affectedTargetIds: ['template:body'],
          requiresHumanReview: false,
        }],
      }),
      reviseCandidate: async input => {
        const updated = updatePostField(
          input.workspaceId,
          input.post.id,
          { introduction: manualIntroduction },
          input.post.generationRevision,
        );
        if (!updated) throw new Error('Expected the operator edit to persist');
        return operationResult(
          input,
          'content-matrix-item-revise',
          { blocks: revisedBlocks(input) },
        );
      },
    });

    expect(result.item.status).toBe('conflict');
    expect(result.item.automaticRevisionCount).toBe(0);
    expect(result.automaticRevisionApplied).toBe(false);
    expect(result.providerCalls).toBe(2);
    expect(getPost(committed.fixture.workspaceId, committed.post.id)).toMatchObject({
      introduction: manualIntroduction,
      generationRevision: committed.post.generationRevision + 1,
    });
  });
});
