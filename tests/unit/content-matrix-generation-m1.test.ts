import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import type { ContentBrief, ContentMatrix, ContentTemplate, GeneratedPost } from '../../shared/types/content.js';
import type { GenerationProvenance } from '../../shared/types/ai-execution.js';
import type {
  MatrixGenerationPreviewTarget,
  ResolvedMatrixStructuralTarget,
} from '../../shared/types/matrix-generation.js';
import db from '../../server/db/index.js';
import { getBrief } from '../../server/content-brief.js';
import { createMatrix, getMatrix, updateMatrixCell } from '../../server/content-matrices.js';
import { createTemplate } from '../../server/content-templates.js';
import { getPost } from '../../server/content-posts-db.js';
import {
  MatrixGenerationEvidenceError,
  resolveContentMatrixEvidence,
} from '../../server/domains/content/matrix-generation/evidence.js';
import { previewMatrixGeneration } from '../../server/domains/content/matrix-generation/preview.js';
import {
  commitMatrixGenerationDraft,
  createMatrixGenerationRun,
  getMatrixGenerationItem,
  listMatrixGenerationItems,
  transitionMatrixGenerationItem,
  transitionMatrixGenerationRun,
} from '../../server/domains/content/matrix-generation/repository.js';
import { generateMatrixCell } from '../../server/domains/content/matrix-generation/single-cell.js';
import { finalizeBrandVoice } from '../../server/domains/brand/voice-finalization.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import {
  addVoiceSample,
  createVoiceProfile,
  getVoiceProfile,
} from '../../server/voice-calibration.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

interface Fixture {
  workspaceId: string;
  template: ContentTemplate;
  matrix: ContentMatrix;
}

const cleanupWorkspaceIds = new Set<string>();

afterEach(() => {
  for (const workspaceId of cleanupWorkspaceIds) {
    setWorkspaceFlagOverride('content-matrix-generation', workspaceId, null);
    deleteWorkspace(workspaceId);
  }
  cleanupWorkspaceIds.clear();
});

function createFixture(cities = ['Austin', 'Dallas']): Fixture {
  const workspaceId = createWorkspace(`M1 matrix generation ${randomUUID()}`).id;
  cleanupWorkspaceIds.add(workspaceId);
  const template = createTemplate(workspaceId, {
    name: 'Generation-ready service template',
    pageType: 'service',
    variables: [
      { name: 'service', label: 'Service' },
      { name: 'city', label: 'City' },
    ],
    sections: [{
      id: 'service-details',
      name: 'Service details',
      headingTemplate: '{service} in {city}',
      guidance: 'Explain the verified service clearly.',
      wordCountTarget: 300,
      order: 0,
      generationRole: 'body',
      aeoContract: { modes: [], required: false },
      ctaContract: { role: 'none', required: false },
    }],
    urlPattern: '/services/{city}/{service}',
    keywordPattern: '{service} in {city}',
    titlePattern: '{service} in {city}',
    metaDescPattern: 'Learn about {service} in {city}.',
    generationContractVersion: 1,
  });
  const matrix = createMatrix(workspaceId, {
    name: 'Service by city',
    templateId: template.id,
    dimensions: [
      { variableName: 'service', values: ['SEO consulting'] },
      { variableName: 'city', values: cities },
    ],
    urlPattern: template.urlPattern,
    keywordPattern: template.keywordPattern,
  }, { validateTemplate: true });
  return { workspaceId, template, matrix };
}

function sourceRevision(fixture: Fixture, cellId: string) {
  const matrix = getMatrix(fixture.workspaceId, fixture.matrix.id)!;
  const cell = matrix.cells.find(candidate => candidate.id === cellId)!;
  return {
    matrixRevision: matrix.revision ?? 0,
    templateRevision: fixture.template.revision ?? 0,
    cellRevision: cell.revision ?? 0,
  };
}

function seedBrandAuthority(workspaceId: string): void {
  createVoiceProfile(workspaceId);
  const sample = addVoiceSample(
    workspaceId,
    'We explain the useful truth clearly, then let the customer decide.',
    'body',
    'manual',
  );
  const profile = getVoiceProfile(workspaceId)!;
  const operator = {
    actorType: 'operator' as const,
    actorId: 'matrix-generation-test-operator',
    actorLabel: 'Matrix generation test operator',
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

async function resolveServiceEvidence(fixture: Fixture, cellId: string) {
  const revision = sourceRevision(fixture, cellId);
  const preview = await previewMatrixGeneration({
    workspaceId: fixture.workspaceId,
    matrixId: fixture.matrix.id,
    selections: [{ cellId, expectedSourceRevision: revision }],
  });
  const blocked = preview.results[0];
  if (!blocked || blocked.status !== 'blocked') throw new Error('Expected blocked preview');
  const requirementId = `matrix-cell:${cellId}:service-availability`;
  const request = {
    workspaceId: fixture.workspaceId,
    matrixId: fixture.matrix.id,
    cellId,
    requirementId,
    value: { kind: 'boolean', value: true },
    sourceRef: {
      sourceType: 'operator_attestation',
      sourceId: `attestation-${cellId}`,
      capturedAt: new Date().toISOString(),
    },
    resolvedBy: {
      actorType: 'operator',
      actorId: 'matrix-generation-test-operator',
    },
    expectedSourceRevision: revision,
    expectedArtifactRevisions: blocked.expectedArtifactRevisions,
    idempotencyKey: `service-evidence-${cellId}`,
  } as const;
  const result = await resolveContentMatrixEvidence(request);
  return { request, result };
}

async function readyTarget(fixture: Fixture, cellId: string): Promise<MatrixGenerationPreviewTarget> {
  const preview = await previewMatrixGeneration({
    workspaceId: fixture.workspaceId,
    matrixId: fixture.matrix.id,
    selections: [{ cellId, expectedSourceRevision: sourceRevision(fixture, cellId) }],
  });
  const result = preview.results[0];
  if (!result || result.status !== 'ready') throw new Error('Expected generation-ready preview');
  return result.target;
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
    estimatedPaidBudget: _estimatedPaidBudget,
    ...resolved
  } = target;
  return resolved;
}

function provenance(operation: string): GenerationProvenance {
  const timestamp = new Date().toISOString();
  return {
    runId: `${operation}-${randomUUID()}`,
    operation,
    provider: 'openai',
    model: 'gpt-5.4',
    inputFingerprint: 'a'.repeat(64),
    startedAt: timestamp,
    completedAt: timestamp,
  };
}

function candidates(
  workspaceId: string,
  target: MatrixGenerationPreviewTarget,
): { brief: ContentBrief; post: GeneratedPost } {
  const now = new Date().toISOString();
  const briefId = `brief_matrix_${randomUUID()}`;
  const brief: ContentBrief = {
    id: briefId,
    workspaceId,
    targetKeyword: target.targetKeyword.value,
    secondaryKeywords: [],
    suggestedTitle: target.title,
    suggestedMetaDesc: target.metaDescription,
    outline: [{
      heading: target.renderedHeadings[0] ?? target.title,
      notes: 'Explain the verified service.',
      wordCount: 300,
    }],
    wordCountTarget: 500,
    intent: 'commercial',
    audience: 'Prospective clients',
    competitorInsights: '',
    internalLinkSuggestions: [],
    createdAt: now,
    pageType: target.pageType,
    keywordLocked: true,
    keywordSource: 'matrix',
    templateId: target.templateId,
    generationProvenance: provenance('content-brief-generate'),
  };
  const post: GeneratedPost = {
    id: `post_matrix_${randomUUID()}`,
    workspaceId,
    briefId,
    targetKeyword: target.targetKeyword.value,
    title: target.title,
    metaDescription: target.metaDescription,
    introduction: '<p>Clear, grounded introduction.</p>',
    sections: [{
      index: 0,
      heading: target.renderedHeadings[0] ?? target.title,
      content: '<p>Verified service details for this page.</p>',
      wordCount: 7,
      targetWordCount: 300,
      keywords: [target.targetKeyword.value],
      status: 'done',
    }],
    conclusion: '<p>Contact the team when you are ready.</p>',
    totalWordCount: 20,
    targetWordCount: 500,
    status: 'draft',
    generationProvenance: provenance('content-post-generate'),
    createdAt: now,
    updatedAt: now,
  };
  return { brief, post };
}

function runAtGeneratingPost(
  fixture: Fixture,
  target: MatrixGenerationPreviewTarget,
  idempotencyKey: string,
) {
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
    idempotencyKey,
    selectionFingerprint: target.effectiveInputFingerprint,
    selections: [selection],
    createdBy: { actorType: 'operator', actorId: 'matrix-generation-test-operator' },
    mcpExecutionContext: null,
  }).run;
  let item = listMatrixGenerationItems(fixture.workspaceId, run.id)[0]!;
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
  return { run, item };
}

describe('content matrix generation M1', () => {
  it('resolves pre-run evidence by durable cell identity and invalidates the old preview', async () => {
    const fixture = createFixture();
    const [cell, sibling] = fixture.matrix.cells;
    const initialRevision = sourceRevision(fixture, cell.id);
    const initialPreview = await previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: initialRevision }],
    });
    const blocked = initialPreview.results[0];
    expect(blocked?.status).toBe('blocked');
    if (!blocked || blocked.status !== 'blocked') return;

    expect(blocked.evidenceRequirements.map(requirement => requirement.id)).toEqual(
      expect.arrayContaining([
        `matrix-cell:${cell.id}:service-availability`,
        `matrix-cell:${cell.id}:cta-details`,
        `matrix-cell:${cell.id}:finalized-voice`,
        `matrix-cell:${cell.id}:approved-identity`,
      ]),
    );
    expect(blocked.blockingRequirementIds).not.toContain(`matrix-cell:${cell.id}:cta-details`);

    await expect(resolveContentMatrixEvidence({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      cellId: cell.id,
      requirementId: `matrix-cell:${cell.id}:service-availability`,
      value: { kind: 'boolean', value: true },
      sourceRef: {
        sourceType: 'content_matrix',
        sourceId: fixture.matrix.id,
        capturedAt: new Date().toISOString(),
      },
      resolvedBy: { actorType: 'operator', actorId: 'test-operator' },
      expectedSourceRevision: initialRevision,
      expectedArtifactRevisions: blocked.expectedArtifactRevisions,
      idempotencyKey: 'structural-source-cannot-prove-fact',
    })).rejects.toMatchObject<Partial<MatrixGenerationEvidenceError>>({
      code: 'precondition_failed',
    });

    const { request, result } = await resolveServiceEvidence(fixture, cell.id);
    expect(result.created).toBe(true);
    expect(result.currentSourceRevision).toEqual({
      ...initialRevision,
      cellRevision: initialRevision.cellRevision + 1,
    });
    const afterResolution = getMatrix(fixture.workspaceId, fixture.matrix.id)!;
    expect(afterResolution.revision).toBe(initialRevision.matrixRevision);
    expect(afterResolution.cells.find(candidate => candidate.id === sibling.id)?.revision)
      .toBe(sibling.revision);

    const replay = await resolveContentMatrixEvidence(request);
    expect(replay).toMatchObject({ created: false, resolution: { id: result.resolution.id } });
    expect(sourceRevision(fixture, cell.id).cellRevision).toBe(initialRevision.cellRevision + 1);

    await expect(previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: initialRevision }],
    })).rejects.toMatchObject({ code: 'conflict' });

    const currentBlocked = await previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: sourceRevision(fixture, cell.id) }],
    });
    const currentResult = currentBlocked.results[0];
    expect(currentResult?.status).toBe('blocked');
    if (!currentResult || currentResult.status !== 'blocked') return;
    expect(currentResult.evidenceRequirements.find(requirement => (
      requirement.id === `matrix-cell:${cell.id}:service-availability`
    ))?.status).toBe('verified');

    seedBrandAuthority(fixture.workspaceId);
    const ready = await readyTarget(fixture, cell.id);
    expect(ready.blockingRequirementIds).toEqual([]);
    expect(ready.identitySnapshot).toHaveLength(1);
    expect(ready.evidenceRequirements.find(requirement => (
      requirement.id === `matrix-cell:${cell.id}:cta-details`
    ))).toMatchObject({ requirementStage: 'ready', status: 'missing' });
    expect(ready.effectiveInputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(ready.estimatedPaidBudget).toMatchObject({ maxConcurrency: 1 });
  });

  it('commits a complete draft atomically, replays the exact start, and rolls back stale work', async () => {
    const fixture = createFixture();
    seedBrandAuthority(fixture.workspaceId);
    const [firstCell, staleCell] = fixture.matrix.cells;
    await resolveServiceEvidence(fixture, firstCell.id);
    await resolveServiceEvidence(fixture, staleCell.id);
    const firstTarget = await readyTarget(fixture, firstCell.id);
    const staleTarget = await readyTarget(fixture, staleCell.id);

    const firstKey = `matrix-run-${randomUUID()}`;
    const firstExecution = runAtGeneratingPost(fixture, firstTarget, firstKey);
    const firstCandidates = candidates(fixture.workspaceId, firstTarget);
    const committed = commitMatrixGenerationDraft({
      workspaceId: fixture.workspaceId,
      itemId: firstExecution.item.id,
      expectedItemRevision: firstExecution.item.revision,
      target: firstTarget,
      ...firstCandidates,
    });
    expect(committed.item).toMatchObject({
      status: 'auditing_deterministic',
      briefId: firstCandidates.brief.id,
      postId: firstCandidates.post.id,
    });
    expect(committed.brief.generationRevision).toBe(1);
    expect(committed.post.generationRevision).toBe(1);
    expect(getMatrix(fixture.workspaceId, fixture.matrix.id)?.cells.find(candidate => (
      candidate.id === firstCell.id
    ))).toMatchObject({
      status: 'draft',
      briefId: firstCandidates.brief.id,
      postId: firstCandidates.post.id,
      revision: firstTarget.sourceRevision.cellRevision + 1,
    });

    setWorkspaceFlagOverride('content-matrix-generation', fixture.workspaceId, true);
    const replay = await generateMatrixCell({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      cellId: firstCell.id,
      expectedSourceRevision: firstTarget.sourceRevision,
      expectedPreviewFingerprint: firstTarget.effectiveInputFingerprint,
      idempotencyKey: firstKey,
      createdBy: { actorType: 'operator', actorId: 'matrix-generation-test-operator' },
      mcpExecutionContext: null,
    });
    expect(replay).toMatchObject({
      status: 'replayed',
      briefId: firstCandidates.brief.id,
      postId: firstCandidates.post.id,
      auditPending: true,
      replayed: true,
    });

    const staleExecution = runAtGeneratingPost(
      fixture,
      staleTarget,
      `matrix-run-${randomUUID()}`,
    );
    const staleCandidates = candidates(fixture.workspaceId, staleTarget);
    updateMatrixCell(
      fixture.workspaceId,
      fixture.matrix.id,
      staleCell.id,
      { clientFlag: 'Operator edit landed during generation' },
      {
        expectedCellRevision: staleTarget.sourceRevision.cellRevision,
        requireExpectedCellRevision: true,
      },
    );

    expect(() => commitMatrixGenerationDraft({
      workspaceId: fixture.workspaceId,
      itemId: staleExecution.item.id,
      expectedItemRevision: staleExecution.item.revision,
      target: staleTarget,
      ...staleCandidates,
    })).toThrow(/changed after preview/i);
    expect(getBrief(fixture.workspaceId, staleCandidates.brief.id)).toBeUndefined();
    expect(getPost(fixture.workspaceId, staleCandidates.post.id)).toBeUndefined();
    expect(getMatrixGenerationItem(fixture.workspaceId, staleExecution.item.id)).toMatchObject({
      status: 'generating_post',
      briefId: null,
      postId: null,
    });
    const preservedCell = getMatrix(fixture.workspaceId, fixture.matrix.id)?.cells.find(candidate => (
      candidate.id === staleCell.id
    ));
    expect(preservedCell).toMatchObject({
      status: 'planned',
      clientFlag: 'Operator edit landed during generation',
    });
    expect(preservedCell).not.toHaveProperty('briefId');
    expect(preservedCell).not.toHaveProperty('postId');
  });
});
