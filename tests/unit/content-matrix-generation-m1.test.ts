import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import type { ContentBrief, ContentMatrix, ContentTemplate, GeneratedPost } from '../../shared/types/content.js';
import type { GenerationProvenance } from '../../shared/types/ai-execution.js';
import type {
  MatrixGenerationPreviewTarget,
  ResolvedMatrixStructuralTarget,
} from '../../shared/types/matrix-generation.js';
import { MATRIX_GENERATION_BATCH_LIMITS } from '../../shared/types/matrix-generation.js';
import db from '../../server/db/index.js';
import { getBrief } from '../../server/content-brief.js';
import { createMatrix, getMatrix, updateMatrixCell } from '../../server/content-matrices.js';
import { createTemplate, getTemplate, updateTemplate } from '../../server/content-templates.js';
import { getPost } from '../../server/content-posts-db.js';
import {
  listCurrentMatrixCellEvidence,
  MatrixGenerationEvidenceError,
  renderMatrixCellEvidencePrompt,
  resolveContentMatrixEvidence,
} from '../../server/domains/content/matrix-generation/evidence.js';
import {
  previewMatrixGeneration,
} from '../../server/domains/content/matrix-generation/preview.js';
import {
  MATRIX_GENERATION_AUTHORITY_UTF8_BYTE_CEILING,
  MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES,
  MATRIX_GENERATION_PROVIDER_INPUT_TOKEN_RESERVATION_CEILING,
  matrixGenerationInputReservationCeiling,
} from '../../server/domains/content/matrix-generation/budget.js';
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
    setWorkspaceFlagOverride('content-matrix-output-quality-v2', workspaceId, null);
    deleteWorkspace(workspaceId);
  }
  cleanupWorkspaceIds.clear();
});

function createFixture(
  cities = ['Austin', 'Dallas'],
  includeOptionalProof = false,
  internalLinkSection: 'none' | 'required' | 'optional' = 'none',
): Fixture {
  const workspaceId = createWorkspace(`M1 matrix generation ${randomUUID()}`).id;
  cleanupWorkspaceIds.add(workspaceId);
  setWorkspaceFlagOverride('content-matrix-generation', workspaceId, true);
  const template = createTemplate(workspaceId, {
    name: 'Generation-ready service template',
    pageType: 'service',
    variables: [
      { name: 'service', label: 'Service' },
      { name: 'city', label: 'City' },
    ],
    sections: [
      {
        id: 'service-details',
        name: 'Service details',
        headingTemplate: '{service} in {city}',
        guidance: 'Explain the verified service clearly.',
        wordCountTarget: 300,
        order: 0,
        generationRole: 'body',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      },
      ...(includeOptionalProof ? [{
        id: 'service-proof',
        name: 'Service proof',
        headingTemplate: 'Why customers choose {service}',
        guidance: 'Use only the supplied proof.',
        wordCountTarget: 150,
        order: 1,
        generationRole: 'proof' as const,
        aeoContract: { modes: [] as [], required: false },
        ctaContract: { role: 'none' as const, required: false },
        optional: true,
      }] : []),
      ...(internalLinkSection === 'none' ? [] : [{
        id: 'related-services',
        name: 'Related services',
        headingTemplate: 'Related services',
        guidance: 'Link to verified related services using the supplied anchor text.',
        wordCountTarget: 100,
        order: 2,
        generationRole: 'body' as const,
        aeoContract: { modes: [] as [], required: false },
        ctaContract: { role: 'none' as const, required: false },
        ...(internalLinkSection === 'optional' ? { optional: true } : {}),
        internalLinkContract: { minimum: 2 },
      }]),
    ],
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

function seedKnownPagePath(workspaceId: string, pagePath: string): void {
  db.prepare(`
    INSERT INTO page_keywords (
      workspace_id, page_path, page_title, primary_keyword, secondary_keywords
    ) VALUES (?, ?, '', '', '[]')
  `).run(workspaceId, pagePath);
}

function sourceRevision(fixture: Fixture, cellId: string) {
  const matrix = getMatrix(fixture.workspaceId, fixture.matrix.id)!;
  const cell = matrix.cells.find(candidate => candidate.id === cellId)!;
  const template = getTemplate(fixture.workspaceId, matrix.templateId)!;
  return {
    matrixRevision: matrix.revision ?? 0,
    templateRevision: template.revision ?? 0,
    cellRevision: cell.revision ?? 0,
  };
}

function seedBrandAuthority(
  workspaceId: string,
  options: { productionShaped?: boolean; authorityOverCeiling?: boolean } = {},
): void {
  createVoiceProfile(workspaceId);
  const voiceSample = options.productionShaped
    ? `FINALIZED VOICE ANCHOR\n${'We explain the useful truth clearly and let the customer decide. '.repeat(130)}`
    : 'We explain the useful truth clearly, then let the customer decide.';
  const sample = addVoiceSample(
    workspaceId,
    voiceSample,
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
  const deliverables = options.productionShaped
    ? [
        {
          type: 'differentiators',
          content: options.authorityOverCeiling
            ? `DIFFERENTIATORS\n${'D'.repeat(64_000)}`
            : `DIFFERENTIATORS\n${'Evidence-backed differentiator detail for the customer. '.repeat(300)}`,
        },
        {
          type: 'objection_handling',
          content: options.authorityOverCeiling
            ? `OBJECTION HANDLING\n${'O'.repeat(64_000)}`
            : `OBJECTION HANDLING\n${'Verified objection followed by an approved, factual response. '.repeat(300)}`,
        },
      ]
    : [{
        type: 'messaging_pillars',
        content: 'Clarity before complexity. Ground every recommendation in evidence.',
      }];
  const insert = db.prepare(`
      INSERT INTO brand_identity_deliverables (
        id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'approved', 1, 'professional', ?, ?)
    `);
  for (const deliverable of deliverables) {
    insert.run(
      `identity_${randomUUID()}`,
      workspaceId,
      deliverable.type,
      deliverable.content,
      now,
      now,
    );
  }
}

function previewSideEffectCounts(workspaceId: string): Record<string, number> {
  const count = (table: string) => (db.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`,
  ).get(workspaceId) as { count: number }).count;
  return {
    runs: count('content_matrix_generation_runs'),
    items: count('content_matrix_generation_items'),
    jobs: count('jobs'),
    briefs: count('content_briefs'),
    posts: count('content_posts'),
  };
}

async function resolveServiceAvailabilityEvidence(fixture: Fixture, cellId: string) {
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

async function resolveServiceDetailsEvidence(
  fixture: Fixture,
  cellId: string,
  capturedAt = new Date().toISOString(),
) {
  const revision = sourceRevision(fixture, cellId);
  const preview = await previewMatrixGeneration({
    workspaceId: fixture.workspaceId,
    matrixId: fixture.matrix.id,
    selections: [{ cellId, expectedSourceRevision: revision }],
  });
  const blocked = preview.results[0];
  if (!blocked || blocked.status !== 'blocked') throw new Error('Expected blocked preview');
  const requirementId = `matrix-cell:${cellId}:service-details`;
  const request = {
    workspaceId: fixture.workspaceId,
    matrixId: fixture.matrix.id,
    cellId,
    requirementId,
    value: {
      kind: 'text_list',
      value: [
        'The service starts with a review of the customer\'s goals and current situation.',
        'The team explains the recommended process and answers questions before work begins.',
        'The customer receives clear next steps based on the findings from the service.',
      ],
    },
    sourceRef: {
      sourceType: 'external_research',
      sourceId: `service-reference-${cellId}`,
      uri: 'https://example.com/verified-service-guide',
      capturedAt,
    },
    resolvedBy: {
      actorType: 'operator',
      actorId: 'matrix-generation-test-operator',
    },
    expectedSourceRevision: revision,
    expectedArtifactRevisions: blocked.expectedArtifactRevisions,
    idempotencyKey: `service-details-${cellId}`,
  } as const;
  const result = await resolveContentMatrixEvidence(request);
  return { request, result };
}

async function resolveRequiredServiceEvidence(fixture: Fixture, cellId: string): Promise<void> {
  await resolveServiceAvailabilityEvidence(fixture, cellId);
  await resolveServiceDetailsEvidence(fixture, cellId);
}

async function resolveInternalLinkEvidence(
  fixture: Fixture,
  cellId: string,
  value: { kind: 'link_list'; value: Array<{ href: string; anchorText: string }> },
  idempotencyKey: string,
) {
  const revision = sourceRevision(fixture, cellId);
  const preview = await previewMatrixGeneration({
    workspaceId: fixture.workspaceId,
    matrixId: fixture.matrix.id,
    selections: [{ cellId, expectedSourceRevision: revision }],
  });
  const previewResult = preview.results[0];
  if (!previewResult || previewResult.status === 'upgrade_required') {
    throw new Error('Expected current-contract link preview');
  }
  const expectedArtifactRevisions = previewResult.status === 'ready'
    ? previewResult.target.expectedArtifactRevisions
    : previewResult.expectedArtifactRevisions;
  return resolveContentMatrixEvidence({
    workspaceId: fixture.workspaceId,
    matrixId: fixture.matrix.id,
    cellId,
    requirementId: `matrix-cell:${cellId}:section:related-services`,
    value,
    sourceRef: {
      sourceType: 'operator_attestation',
      sourceId: `verified-links-${idempotencyKey}`,
      capturedAt: new Date().toISOString(),
    },
    resolvedBy: { actorType: 'operator', actorId: 'matrix-generation-test-operator' },
    expectedSourceRevision: revision,
    expectedArtifactRevisions,
    idempotencyKey,
  });
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
    outputQualityV2: _outputQualityV2,
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
    model: 'gpt-5.6-terra',
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
      content: `<h2>${target.renderedHeadings[0] ?? target.title}</h2><p>Verified service details for this page.</p>`,
      wordCount: 7,
      targetWordCount: 300,
      keywords: [target.targetKeyword.value],
      status: 'done',
    }],
    conclusion: '<h2>Next</h2><p>Contact the team when you are ready.</p>',
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
  it('rejects a disabled workspace before reading matrix sources or running a census', async () => {
    const workspaceId = createWorkspace(`M1 disabled preview ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    setWorkspaceFlagOverride('content-matrix-generation', workspaceId, false);

    await expect(previewMatrixGeneration({
      workspaceId,
      matrixId: 'matrix-that-must-not-be-read',
      selections: [{
        cellId: 'cell-that-must-not-be-read',
        expectedSourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
      }],
    })).rejects.toMatchObject({
      code: 'precondition_failed',
      details: {
        reason: 'feature_disabled',
        retryable: false,
        fieldPath: 'workspace_id',
      },
    });
  });

  it('freezes output-quality policy in preview authority and invalidates the fingerprint on change', async () => {
    const fixture = createFixture(['Austin']);
    const cell = fixture.matrix.cells[0];
    seedBrandAuthority(fixture.workspaceId);
    await resolveRequiredServiceEvidence(fixture, cell.id);

    setWorkspaceFlagOverride('content-matrix-output-quality-v2', fixture.workspaceId, false);
    const legacyPolicy = await readyTarget(fixture, cell.id);
    expect(legacyPolicy.outputQualityV2).toBe(false);

    setWorkspaceFlagOverride('content-matrix-output-quality-v2', fixture.workspaceId, true);
    const qualityPolicy = await readyTarget(fixture, cell.id);
    expect(qualityPolicy.outputQualityV2).toBe(true);
    expect(qualityPolicy.effectiveInputFingerprint).not.toBe(
      legacyPolicy.effectiveInputFingerprint,
    );

    const execution = runAtGeneratingPost(
      fixture,
      qualityPolicy,
      `matrix-policy-${randomUUID()}`,
    );
    setWorkspaceFlagOverride('content-matrix-output-quality-v2', fixture.workspaceId, false);
    expect(getMatrixGenerationItem(fixture.workspaceId, execution.item.id)?.previewTarget)
      .toMatchObject({ outputQualityV2: true });
  });

  it('rehydrates a legacy queued target and preserves its default-policy preflight fingerprint', async () => {
    const fixture = createFixture(['Austin']);
    const cell = fixture.matrix.cells[0];
    seedBrandAuthority(fixture.workspaceId);
    await resolveRequiredServiceEvidence(fixture, cell.id);
    setWorkspaceFlagOverride('content-matrix-output-quality-v2', fixture.workspaceId, false);
    const target = await readyTarget(fixture, cell.id);
    const { outputQualityV2: _legacyMissingPolicy, ...legacyStoredTarget } = target;
    const selection = {
      matrixId: target.matrixId,
      cellId: target.cellId,
      sourceRevision: target.sourceRevision,
      structuralFingerprint: target.structuralFingerprint,
      previewFingerprint: target.effectiveInputFingerprint,
    };
    const run = createMatrixGenerationRun({
      workspaceId: fixture.workspaceId,
      matrixId: target.matrixId,
      templateId: target.templateId,
      idempotencyKey: `matrix-legacy-policy-${randomUUID()}`,
      selectionFingerprint: target.effectiveInputFingerprint,
      selections: [selection],
      createdBy: { actorType: 'operator', actorId: 'matrix-generation-test-operator' },
      mcpExecutionContext: null,
    }).run;
    const queuedItem = listMatrixGenerationItems(fixture.workspaceId, run.id)[0];
    db.prepare(`
      UPDATE content_matrix_generation_items
      SET preview_target = ?
      WHERE id = ? AND workspace_id = ?
    `).run(JSON.stringify(legacyStoredTarget), queuedItem.id, fixture.workspaceId);

    const rehydrated = getMatrixGenerationItem(fixture.workspaceId, queuedItem.id);
    expect(rehydrated?.status).toBe('queued');
    expect(rehydrated?.previewTarget).toMatchObject({
      outputQualityV2: false,
      effectiveInputFingerprint: target.effectiveInputFingerprint,
    });
    const repreflight = await readyTarget(fixture, cell.id);
    expect(repreflight.outputQualityV2).toBe(false);
    expect(repreflight.effectiveInputFingerprint).toBe(rehydrated?.previewFingerprint);
  });

  it('marks approved-artifact replacement as human-only while normal evidence stays resolvable', async () => {
    const fixture = createFixture(['Austin']);
    const cell = fixture.matrix.cells[0];
    seedBrandAuthority(fixture.workspaceId);
    await resolveRequiredServiceEvidence(fixture, cell.id);
    updateMatrixCell(fixture.workspaceId, fixture.matrix.id, cell.id, { status: 'approved' });

    const preview = await previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: sourceRevision(fixture, cell.id) }],
    });
    const result = preview.results[0];
    expect(result?.status).toBe('blocked');
    if (!result || result.status !== 'blocked') return;

    expect(result.diagnostics.requirementsComplete).toBe(true);
    expect(result.evidenceRequirements.find(requirement => (
      requirement.id.endsWith(':replacement-authorization')
    ))).toMatchObject({
      status: 'missing',
      resolvable: false,
      resolutionAuthority: 'human_authorization',
    });
    expect(result.evidenceRequirements.find(requirement => (
      requirement.id.endsWith(':service-details')
    ))).toMatchObject({
      status: 'verified',
      resolvable: true,
      resolutionAuthority: 'evidence_submission',
    });
  });

  it('marks structural early-return requirements as explicitly incomplete', async () => {
    const fixture = createFixture(['Austin']);
    const cell = fixture.matrix.cells[0];
    seedKnownPagePath(fixture.workspaceId, cell.plannedUrl);

    const preview = await previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: sourceRevision(fixture, cell.id) }],
    });

    expect(preview.results[0]).toMatchObject({
      status: 'blocked',
      diagnostics: { requirementsComplete: false },
      blockingRequirementIds: expect.arrayContaining(['workspace_url_collision']),
    });
    expect(preview.estimatedBatchBudget).toBeNull();
  });

  it('previews production-shaped single and multi-cell authority deterministically without paid side effects', async () => {
    const fixture = createFixture(['Austin', 'Dallas']);
    const [firstCell, secondCell] = fixture.matrix.cells;
    seedBrandAuthority(fixture.workspaceId, { productionShaped: true });
    await resolveRequiredServiceEvidence(fixture, firstCell.id);
    await resolveRequiredServiceEvidence(fixture, secondCell.id);
    const before = previewSideEffectCounts(fixture.workspaceId);

    const singleRequest = {
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{
        cellId: firstCell.id,
        expectedSourceRevision: sourceRevision(fixture, firstCell.id),
      }],
    };
    const single = await previewMatrixGeneration(singleRequest);
    const singleRepeat = await previewMatrixGeneration(singleRequest);
    expect(single.results).toHaveLength(1);
    expect(single.results[0]?.status).toBe('ready');
    if (single.results[0]?.status === 'ready') {
      expect(single.results[0].target).not.toHaveProperty('verifiedInternalLinks');
      expect(single.results[0].diagnostics).toEqual({
        requirementsComplete: true,
        sourceLimitIssues: [],
        sourceLimitIssuesTruncated: false,
        censusFailures: [],
      });
      expect(single.results[0].target.frozenEvidenceResolutionIds).toHaveLength(2);
      expect(single.results[0].target.frozenEvidenceResolutionIds)
        .toEqual([...single.results[0].target.frozenEvidenceResolutionIds].sort());
    }
    expect(singleRepeat).toEqual(single);
    expect(single.estimatedBatchBudget).toMatchObject({ maxConcurrency: 1 });
    expect(Number.isFinite(single.estimatedBatchBudget?.estimatedUsd)).toBe(true);

    const multiRequest = {
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [firstCell, secondCell].map(cell => ({
        cellId: cell.id,
        expectedSourceRevision: sourceRevision(fixture, cell.id),
      })) as [
        { cellId: string; expectedSourceRevision: ReturnType<typeof sourceRevision> },
        { cellId: string; expectedSourceRevision: ReturnType<typeof sourceRevision> },
      ],
    };
    const multi = await previewMatrixGeneration(multiRequest);
    const multiRepeat = await previewMatrixGeneration(multiRequest);
    expect(multi.results.map(result => result.status)).toEqual(['ready', 'ready']);
    expect(multiRepeat).toEqual(multi);
    expect(multi.estimatedBatchBudget?.maxConcurrency).toBe(2);
    expect(Number.isFinite(multi.estimatedBatchBudget?.inputTokens)).toBe(true);
    expect(Number.isFinite(multi.estimatedBatchBudget?.estimatedUsd)).toBe(true);
    expect(multi.estimatedBatchBudget).toMatchObject({
      providerCalls: expect.any(Number),
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      estimatedUsd: expect.any(Number),
    });
    expect(multi.estimatedBatchBudget!.providerCalls)
      .toBeLessThanOrEqual(MATRIX_GENERATION_BATCH_LIMITS.maxProviderCalls);
    expect(multi.estimatedBatchBudget!.inputTokens)
      .toBeLessThanOrEqual(MATRIX_GENERATION_BATCH_LIMITS.maxInputTokens);
    expect(multi.estimatedBatchBudget!.outputTokens)
      .toBeLessThanOrEqual(MATRIX_GENERATION_BATCH_LIMITS.maxOutputTokens);
    expect(multi.estimatedBatchBudget!.estimatedUsd)
      .toBeLessThanOrEqual(MATRIX_GENERATION_BATCH_LIMITS.maxEstimatedUsd);
    expect(multi.estimatedBatchBudget!.maxConcurrency)
      .toBeLessThanOrEqual(MATRIX_GENERATION_BATCH_LIMITS.maxConcurrency);
    expect(MATRIX_GENERATION_PROVIDER_INPUT_TOKEN_RESERVATION_CEILING).toBe(
      matrixGenerationInputReservationCeiling(
        MATRIX_GENERATION_PROVIDER_INPUT_ENVELOPE_UTF8_BYTES,
      ),
    );
    expect(MATRIX_GENERATION_PROVIDER_INPUT_TOKEN_RESERVATION_CEILING)
      .toBeLessThan(MATRIX_GENERATION_BATCH_LIMITS.maxInputTokens);
    expect(previewSideEffectCounts(fixture.workspaceId)).toEqual(before);
  });

  it('returns a typed ready-tail precondition above the exact UTF-8 authority ceiling', async () => {
    const fixture = createFixture(['Austin']);
    const [cell] = fixture.matrix.cells;
    seedBrandAuthority(fixture.workspaceId, {
      productionShaped: true,
      authorityOverCeiling: true,
    });
    await resolveRequiredServiceEvidence(fixture, cell.id);

    await expect(previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{
        cellId: cell.id,
        expectedSourceRevision: sourceRevision(fixture, cell.id),
      }],
    })).rejects.toMatchObject({
      name: 'MatrixGenerationPreviewStageError',
      code: 'precondition_failed',
      stage: 'generation_context',
      cellId: cell.id,
      classification: 'matrix_generation_authority_budget',
      fieldPath: 'generation_context.authority',
      constraint: `serialized frozen voice, approved identity, and custom notes must not exceed ${MATRIX_GENERATION_AUTHORITY_UTF8_BYTE_CEILING} UTF-8 bytes`,
    });
  });

  it('exposes optional omissions and includes the section only after exact evidence resolution', async () => {
    const fixture = createFixture(['Austin'], true);
    const cell = fixture.matrix.cells[0];
    const initialRevision = sourceRevision(fixture, cell.id);
    const initial = await previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: initialRevision }],
    });
    const initialResult = initial.results[0];
    expect(initialResult?.status).toBe('blocked');
    if (!initialResult || initialResult.status !== 'blocked') return;
    expect(initialResult.diagnostics.requirementsComplete).toBe(true);

    const requirementId = `matrix-cell:${cell.id}:section:service-proof`;
    expect(initialResult.omittedOptionalSections).toEqual([
      expect.objectContaining({
        sourceSectionId: 'service-proof',
        evidenceRequirementId: requirementId,
        reason: 'missing_section_evidence',
      }),
    ]);
    expect(initialResult.evidenceRequirements.find(item => item.id === requirementId)).toMatchObject({
      requirementStage: 'optional_omit',
      status: 'missing',
      resolvable: true,
      resolutionAuthority: 'evidence_submission',
    });
    expect(initialResult.blockingRequirementIds).not.toContain(requirementId);

    await expect(resolveContentMatrixEvidence({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      cellId: cell.id,
      requirementId,
      value: {
        kind: 'link_list',
        value: [{ href: '/unrelated', anchorText: 'Unrelated page' }],
      },
      sourceRef: {
        sourceType: 'operator_attestation',
        sourceId: 'wrong-section-link-list',
        capturedAt: new Date().toISOString(),
      },
      resolvedBy: { actorType: 'operator', actorId: 'test-operator' },
      expectedSourceRevision: initialRevision,
      expectedArtifactRevisions: initialResult.expectedArtifactRevisions,
      idempotencyKey: 'wrong-section-link-list',
    })).rejects.toThrow('exact declared section requirement');

    await resolveContentMatrixEvidence({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      cellId: cell.id,
      requirementId,
      value: { kind: 'text', value: 'Customers consistently cite the clear process and practical next steps.' },
      sourceRef: {
        sourceType: 'operator_attestation',
        sourceId: 'service-proof-attestation',
        capturedAt: new Date().toISOString(),
      },
      resolvedBy: { actorType: 'operator', actorId: 'test-operator' },
      expectedSourceRevision: initialRevision,
      expectedArtifactRevisions: initialResult.expectedArtifactRevisions,
      idempotencyKey: 'optional-service-proof',
    });

    const after = await previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: sourceRevision(fixture, cell.id) }],
    });
    const afterResult = after.results[0];
    expect(afterResult?.status).toBe('blocked');
    if (!afterResult || afterResult.status !== 'blocked') return;
    expect(afterResult.omittedOptionalSections).toEqual([]);
    expect(afterResult.evidenceRequirements.find(item => item.id === requirementId)?.status)
      .toBe('verified');

    const currentTemplate = getTemplate(fixture.workspaceId, fixture.template.id)!;
    updateTemplate(fixture.workspaceId, currentTemplate.id, {
      sections: currentTemplate.sections.map(section => (
        section.id === 'service-proof'
          ? { ...section, guidance: 'Use the newly changed proof contract only.' }
          : section
      )),
    }, { expectedTemplateRevision: currentTemplate.revision });

    const afterTemplateChange = await previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: sourceRevision(fixture, cell.id) }],
    });
    const staleResult = afterTemplateChange.results[0];
    expect(staleResult?.status).toBe('blocked');
    if (!staleResult || staleResult.status !== 'blocked') return;
    expect(staleResult.omittedOptionalSections).toEqual([
      expect.objectContaining({ sourceSectionId: 'service-proof' }),
    ]);
    expect(staleResult.evidenceRequirements.find(item => item.id === requirementId)?.status)
      .toBe('missing');
    expect(renderMatrixCellEvidencePrompt(
      staleResult.evidenceRequirements,
      listCurrentMatrixCellEvidence(fixture.workspaceId, fixture.matrix.id, cell.id),
    )).not.toContain('Customers consistently cite');
  });

  it('validates, canonicalizes, freezes, and fingerprints only verified internal destinations', async () => {
    const fixture = createFixture(['Austin'], false, 'required');
    const cell = fixture.matrix.cells[0];
    seedKnownPagePath(fixture.workspaceId, '/services');
    seedKnownPagePath(fixture.workspaceId, '/financing');
    seedBrandAuthority(fixture.workspaceId);
    await resolveRequiredServiceEvidence(fixture, cell.id);

    const blocked = await previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: sourceRevision(fixture, cell.id) }],
    });
    const blockedResult = blocked.results[0];
    expect(blockedResult?.status).toBe('blocked');
    if (!blockedResult || blockedResult.status !== 'blocked') return;
    const linkRequirementId = `matrix-cell:${cell.id}:section:related-services`;
    expect(blockedResult.evidenceRequirements.find(item => item.id === linkRequirementId))
      .toMatchObject({
        fieldPath: 'sections.related-services.internal_links',
        requirementStage: 'preflight',
        status: 'missing',
      });
    expect(blockedResult.blockingRequirementIds).toContain(linkRequirementId);

    await expect(resolveInternalLinkEvidence(fixture, cell.id, {
      kind: 'link_list',
      value: [
        { href: 'https://example.com/services', anchorText: 'All services' },
        { href: '/financing', anchorText: 'Financing' },
      ],
    }, 'external-link')).rejects.toMatchObject({ code: 'precondition_failed' });
    await expect(resolveInternalLinkEvidence(fixture, cell.id, {
      kind: 'link_list',
      value: [
        { href: cell.plannedUrl, anchorText: 'This page' },
        { href: '/financing', anchorText: 'Financing' },
      ],
    }, 'self-link')).rejects.toThrow('cannot point to the page being generated');
    await expect(resolveInternalLinkEvidence(fixture, cell.id, {
      kind: 'link_list',
      value: [
        { href: '/unknown', anchorText: 'Unknown page' },
        { href: '/financing', anchorText: 'Financing' },
      ],
    }, 'unknown-link')).rejects.toThrow('current workspace page census');
    await expect(resolveInternalLinkEvidence(fixture, cell.id, {
      kind: 'link_list',
      value: [
        { href: '/services', anchorText: 'All services' },
        { href: '/services/', anchorText: 'Duplicate services' },
      ],
    }, 'duplicate-link')).rejects.toMatchObject({
      code: 'precondition_failed',
      message: expect.stringContaining('cannot repeat the same canonical destination'),
    });
    await expect(resolveInternalLinkEvidence(fixture, cell.id, {
      kind: 'link_list',
      value: [
        { href: '/services', anchorText: 'All services' },
        { href: '/services/', anchorText: 'Duplicate services' },
        { href: '/financing', anchorText: 'Financing' },
      ],
    }, 'duplicate-link-minimum-met')).rejects.toMatchObject({
      code: 'precondition_failed',
      message: expect.stringContaining('cannot repeat the same canonical destination'),
    });

    await resolveInternalLinkEvidence(fixture, cell.id, {
      kind: 'link_list',
      value: [
        { href: '/services/', anchorText: '  All services  ' },
        { href: '/financing', anchorText: 'Financing options' },
      ],
    }, 'valid-links');
    const request = {
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: sourceRevision(fixture, cell.id) }],
    } as const;
    const ready = await previewMatrixGeneration(request);
    const repeat = await previewMatrixGeneration(request);
    expect(repeat).toEqual(ready);
    const result = ready.results[0];
    expect(result?.status).toBe('ready');
    if (!result || result.status !== 'ready') return;
    expect(result.target.verifiedInternalLinks).toEqual([{
      blockId: 'template:related-services',
      sourceSectionId: 'related-services',
      evidenceRequirementId: linkRequirementId,
      minimum: 2,
      links: [
        { href: '/services', anchorText: 'All services' },
        { href: '/financing', anchorText: 'Financing options' },
      ],
    }]);
    expect(result.target.effectiveInputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(renderMatrixCellEvidencePrompt(
      result.target.evidenceRequirements,
      listCurrentMatrixCellEvidence(fixture.workspaceId, fixture.matrix.id, cell.id),
    )).not.toContain('/services');

    const beforeCensusDrift = previewSideEffectCounts(fixture.workspaceId);
    db.prepare('DELETE FROM page_keywords WHERE workspace_id = ? AND page_path = ?')
      .run(fixture.workspaceId, '/financing');
    const afterDestinationRemoval = await previewMatrixGeneration(request);
    const removedResult = afterDestinationRemoval.results[0];
    expect(removedResult?.status).toBe('blocked');
    if (!removedResult || removedResult.status !== 'blocked') return;
    expect(removedResult.blockingRequirementIds).toContain(linkRequirementId);
    expect(removedResult.evidenceRequirements.find(item => item.id === linkRequirementId))
      .toMatchObject({ status: 'missing', requirementStage: 'preflight' });
    expect(previewSideEffectCounts(fixture.workspaceId)).toEqual(beforeCensusDrift);

    seedKnownPagePath(fixture.workspaceId, '/financing');
    const restored = await previewMatrixGeneration(request);
    expect(restored.results[0]?.status).toBe('ready');

    const currentTemplate = getTemplate(fixture.workspaceId, fixture.template.id)!;
    updateTemplate(fixture.workspaceId, currentTemplate.id, {
      sections: currentTemplate.sections.map(section => (
        section.id === 'related-services'
          ? { ...section, guidance: `${section.guidance} Keep the links concise.` }
          : section
      )),
    }, { expectedTemplateRevision: currentTemplate.revision });
    const afterTemplateChange = await previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: sourceRevision(fixture, cell.id) }],
    });
    const staleResult = afterTemplateChange.results[0];
    expect(staleResult?.status).toBe('blocked');
    if (!staleResult || staleResult.status !== 'blocked') return;
    expect(staleResult.blockingRequirementIds).toContain(linkRequirementId);
    expect(staleResult.evidenceRequirements.find(item => item.id === linkRequirementId))
      .toMatchObject({ status: 'missing', requirementStage: 'preflight' });
    expect(previewSideEffectCounts(fixture.workspaceId)).toEqual(beforeCensusDrift);
  });

  it('keeps an optional internal-link block omitted until its exact link evidence exists', async () => {
    const fixture = createFixture(['Austin'], false, 'optional');
    const cell = fixture.matrix.cells[0];
    seedKnownPagePath(fixture.workspaceId, '/services');
    seedKnownPagePath(fixture.workspaceId, '/financing');
    seedBrandAuthority(fixture.workspaceId);
    await resolveRequiredServiceEvidence(fixture, cell.id);

    const before = await readyTarget(fixture, cell.id);
    const requirementId = `matrix-cell:${cell.id}:section:related-services`;
    expect(before.blockManifest.omittedOptionalSections).toEqual([
      expect.objectContaining({
        sourceSectionId: 'related-services',
        evidenceRequirementId: requirementId,
        internalLinkContract: { minimum: 2 },
      }),
    ]);
    expect(before.evidenceRequirements.find(item => item.id === requirementId)).toMatchObject({
      requirementStage: 'optional_omit',
      status: 'missing',
    });
    expect(before).not.toHaveProperty('verifiedInternalLinks');

    await resolveInternalLinkEvidence(fixture, cell.id, {
      kind: 'link_list',
      value: [
        { href: '/services', anchorText: 'All services' },
        { href: '/financing', anchorText: 'Financing options' },
      ],
    }, 'optional-links');
    const after = await readyTarget(fixture, cell.id);
    expect(after.blockManifest.omittedOptionalSections).toEqual([]);
    expect(after.blockManifest.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'template:related-services' }),
    ]));
    expect(after.verifiedInternalLinks).toEqual([
      expect.objectContaining({
        blockId: 'template:related-services',
        evidenceRequirementId: requirementId,
        minimum: 2,
      }),
    ]);
  });

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
        `matrix-cell:${cell.id}:service-details`,
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

    const { request, result } = await resolveServiceAvailabilityEvidence(fixture, cell.id);
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
    const serviceDetailsRequirementId = `matrix-cell:${cell.id}:service-details`;
    expect(currentResult.blockingRequirementIds).toContain(serviceDetailsRequirementId);

    await expect(resolveContentMatrixEvidence({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      cellId: cell.id,
      requirementId: serviceDetailsRequirementId,
      value: { kind: 'boolean', value: true },
      sourceRef: {
        sourceType: 'operator_attestation',
        sourceId: 'service-details-too-thin',
        capturedAt: new Date().toISOString(),
      },
      resolvedBy: { actorType: 'operator', actorId: 'test-operator' },
      expectedSourceRevision: sourceRevision(fixture, cell.id),
      expectedArtifactRevisions: currentResult.expectedArtifactRevisions,
      idempotencyKey: 'service-details-too-thin',
    })).rejects.toMatchObject<Partial<MatrixGenerationEvidenceError>>({
      code: 'precondition_failed',
    });

    const historicalServiceCapture = '2020-01-02T03:04:05.000Z';
    await resolveServiceDetailsEvidence(fixture, cell.id, historicalServiceCapture);
    const resolutions = listCurrentMatrixCellEvidence(
      fixture.workspaceId,
      fixture.matrix.id,
      cell.id,
    );
    const afterDetails = await previewMatrixGeneration({
      workspaceId: fixture.workspaceId,
      matrixId: fixture.matrix.id,
      selections: [{ cellId: cell.id, expectedSourceRevision: sourceRevision(fixture, cell.id) }],
    });
    const afterDetailsResult = afterDetails.results[0];
    expect(afterDetailsResult?.status).toBe('blocked');
    if (!afterDetailsResult || afterDetailsResult.status !== 'blocked') return;
    expect(renderMatrixCellEvidencePrompt(afterDetailsResult.evidenceRequirements, resolutions))
      .toContain('MATRIX PAGE FACTS');
    expect(renderMatrixCellEvidencePrompt(afterDetailsResult.evidenceRequirements, resolutions))
      .toContain('service.details: The service starts with a review');

    seedBrandAuthority(fixture.workspaceId);
    const ready = await readyTarget(fixture, cell.id);
    expect(ready.blockingRequirementIds).toEqual([]);
    expect(ready.evidenceFreshThrough).toBe(historicalServiceCapture);
    expect(ready.identitySnapshot).toHaveLength(1);
    expect(ready.evidenceRequirements.find(requirement => (
      requirement.id === `matrix-cell:${cell.id}:cta-details`
    ))).toMatchObject({ requirementStage: 'ready', status: 'missing' });
    expect(ready.effectiveInputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(ready.estimatedPaidBudget).toMatchObject({ maxConcurrency: 1 });
  });

  it('rejects invalid headings before any draft artifact or matrix state is committed', async () => {
    const fixture = createFixture(['Austin']);
    seedBrandAuthority(fixture.workspaceId);
    const cell = fixture.matrix.cells[0];
    await resolveRequiredServiceEvidence(fixture, cell.id);
    const targetValue = await readyTarget(fixture, cell.id);
    const execution = runAtGeneratingPost(fixture, targetValue, `matrix-run-${randomUUID()}`);
    const generated = candidates(fixture.workspaceId, targetValue);
    generated.post.sections[0].content += '<h2>Duplicate model heading</h2>';

    expect(() => commitMatrixGenerationDraft({
      workspaceId: fixture.workspaceId,
      itemId: execution.item.id,
      expectedItemRevision: execution.item.revision,
      target: targetValue,
      ...generated,
    })).toThrow(/headings do not match the accepted block manifest/i);
    expect(getBrief(fixture.workspaceId, generated.brief.id)).toBeUndefined();
    expect(getPost(fixture.workspaceId, generated.post.id)).toBeUndefined();
    expect(getMatrixGenerationItem(fixture.workspaceId, execution.item.id)).toMatchObject({
      status: 'generating_post',
      briefId: null,
      postId: null,
    });
    expect(getMatrix(fixture.workspaceId, fixture.matrix.id)?.cells[0]).toMatchObject({
      status: 'planned',
    });
  });

  it('commits a complete draft atomically, replays the exact start, and rolls back stale work', async () => {
    const fixture = createFixture();
    seedBrandAuthority(fixture.workspaceId);
    const [firstCell, staleCell] = fixture.matrix.cells;
    await resolveRequiredServiceEvidence(fixture, firstCell.id);
    await resolveRequiredServiceEvidence(fixture, staleCell.id);
    const firstTarget = await readyTarget(fixture, firstCell.id);
    const staleTarget = await readyTarget(fixture, staleCell.id);

    const firstKey = `matrix-run-${randomUUID()}`;
    const firstExecution = runAtGeneratingPost(fixture, firstTarget, firstKey);
    const firstCandidates = candidates(fixture.workspaceId, firstTarget);
    firstCandidates.post.sections[0].heading = 'Stale pre-commit metadata';
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
    expect(committed.post.sections[0].heading).toBe(firstTarget.renderedHeadings[0]);
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
    })).toThrow(expect.objectContaining({
      details: expect.objectContaining({
        reason: 'source_revision_changed',
        retryable: true,
        constraint: 're-preview immediately using current authority',
      }),
    }));
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
