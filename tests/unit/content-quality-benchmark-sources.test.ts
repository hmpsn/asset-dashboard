import { describe, expect, it, vi } from 'vitest';
import type { CopySection } from '../../shared/types/copy-pipeline.js';
import type { GeneratedPost } from '../../shared/types/content.js';
import type { MatrixGenerationItem } from '../../shared/types/matrix-generation.js';
import {
  CONTENT_QUALITY_BENCHMARK_OPERATOR_ATTESTATION,
  ContentQualityBenchmarkSourceError,
  qualifyApprovedCopySections,
  qualifyMatrixApprovedPost,
  qualifyMatrixBenchmarkCandidate,
  qualifyOperatorCuratedPage,
} from '../../scripts/content-quality-benchmark-sources.js';

const approvedAt = '2026-07-20T12:00:00.000Z';

function post(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    id: 'post-1',
    workspaceId: 'ws-1',
    briefId: 'brief-1',
    targetKeyword: 'care',
    title: 'Approved care',
    metaDescription: 'Approved page',
    introduction: '<p>Intro</p>',
    sections: [{
      index: 0,
      heading: 'Proof',
      content: '<h2>Proof</h2><p>Verified detail.</p>',
      wordCount: 3,
      targetWordCount: 3,
      keywords: [],
      status: 'done',
    }],
    conclusion: '<p>Next step.</p>',
    totalWordCount: 6,
    targetWordCount: 6,
    status: 'approved',
    generationRevision: 7,
    createdAt: approvedAt,
    updatedAt: approvedAt,
    ...overrides,
  };
}

function item(overrides: Partial<MatrixGenerationItem> = {}): MatrixGenerationItem {
  return {
    id: 'item-1',
    runId: 'run-1',
    workspaceId: 'ws-1',
    matrixId: 'matrix-1',
    cellId: 'cell-1',
    sourceRevision: { matrixRevision: 1, templateRevision: 2, cellRevision: 3 },
    status: 'ready_for_human_review',
    revision: 4,
    structuralFingerprint: 'structural',
    previewFingerprint: 'a'.repeat(64),
    structuralTarget: null,
    previewTarget: null,
    briefId: 'brief-1',
    postId: 'post-1',
    auditReport: null,
    approvalEvidence: {
      runId: 'run-1',
      itemId: 'item-1',
      matrixId: 'matrix-1',
      cellId: 'cell-1',
      sourceRevision: { matrixRevision: 1, templateRevision: 2, cellRevision: 3 },
      postId: 'post-1',
      postRevision: 7,
      approvedBy: { type: 'human', id: 'reviewer-1' },
      approvedAt,
    },
    attemptCount: 1,
    automaticRevisionCount: 0,
    error: null,
    createdAt: approvedAt,
    updatedAt: approvedAt,
    completedAt: approvedAt,
    ...overrides,
  };
}

function copySection(id: string, overrides: Partial<CopySection> = {}): CopySection {
  return {
    id,
    workspaceId: 'ws-1',
    entryId: 'entry-1',
    sectionPlanItemId: `plan-${id}`,
    generatedCopy: `<p>${id} approved copy</p>`,
    status: 'approved',
    aiAnnotation: null,
    aiReasoning: null,
    steeringHistory: [],
    clientSuggestions: null,
    qualityFlags: null,
    version: 2,
    generationRevision: 5,
    createdAt: approvedAt,
    updatedAt: approvedAt,
    ...overrides,
  };
}

describe('content quality benchmark source qualification', () => {
  it('qualifies an exact matrix post only when approval matches its current revision', () => {
    const readers = {
      getMatrixGenerationItem: vi.fn(() => item()),
      getPost: vi.fn(() => post()),
    };
    const result = qualifyMatrixApprovedPost({
      kind: 'matrix_approved_post',
      workspaceId: 'ws-1',
      itemId: 'item-1',
      postId: 'post-1',
    }, readers);

    expect(readers.getMatrixGenerationItem).toHaveBeenCalledWith('ws-1', 'item-1');
    expect(readers.getPost).toHaveBeenCalledWith('ws-1', 'post-1');
    expect(result.reference).toMatchObject({
      kind: 'matrix_approved_post',
      approvalKind: 'human_approved',
      sourceRevision: 7,
      approvedAt,
    });
    expect(result.reference.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.referenceHtml).toContain('<h1>Approved care</h1>');
  });

  it.each([
    { label: 'review-ready only', item: item({ approvalEvidence: null }) },
    { label: 'stale revision', item: item(), post: post({ generationRevision: 8 }) },
    {
      label: 'stale source revision',
      item: item({
        approvalEvidence: {
          ...item().approvalEvidence!,
          sourceRevision: { matrixRevision: 1, templateRevision: 2, cellRevision: 2 },
        },
      }),
    },
    { label: 'unapproved post', item: item(), post: post({ status: 'review' }) },
    { label: 'cross-workspace row', item: item({ workspaceId: 'ws-2' }) },
  ])('fails closed for a $label matrix source', ({ item: matrixItem, post: matrixPost = post() }) => {
    expect(() => qualifyMatrixApprovedPost({
      kind: 'matrix_approved_post',
      workspaceId: 'ws-1',
      itemId: 'item-1',
      postId: 'post-1',
    }, {
      getMatrixGenerationItem: () => matrixItem,
      getPost: () => matrixPost,
    })).toThrow(ContentQualityBenchmarkSourceError);
  });

  it('constructs a blinded matrix candidate from current durable authority', () => {
    const matrixItem = item({
      previewTarget: {
        workspaceId: 'ws-1',
        matrixId: 'matrix-1',
        cellId: 'cell-1',
        effectiveInputFingerprint: 'a'.repeat(64),
      } as MatrixGenerationItem['previewTarget'],
      auditReport: {
        verdict: 'ready_for_human_review',
        deterministicChecks: [{
          id: 'heading-contract',
          category: 'structure',
          result: 'passed',
          message: 'Sensitive runtime detail',
          evidenceRequirementIds: ['evidence-private'],
        }],
        modelFindings: [],
        humanRequiredChecks: [],
        revisionCount: 0,
        auditedAt: approvedAt,
        unresolvedRequirementIds: [],
      },
    });
    const generatedPost = post({
      status: 'draft',
      generationProvenance: {
        runId: 'provider-run-1',
        operation: 'content-matrix-post',
        provider: 'anthropic',
        model: 'creative-model',
        inputFingerprint: 'b'.repeat(64),
        startedAt: '2026-07-20T12:00:00.000Z',
        completedAt: '2026-07-20T12:00:01.250Z',
      },
    });
    const result = qualifyMatrixBenchmarkCandidate({
      workspaceId: 'ws-1',
      itemId: 'item-1',
      postId: 'post-1',
      anonymousLabel: 'candidate_a',
      usage: { promptTokens: 120, completionTokens: 80, estimatedCostUsd: 0.04 },
    }, {
      getMatrixGenerationItem: () => matrixItem,
      getPost: () => generatedPost,
    });

    expect(result).toMatchObject({
      anonymousLabel: 'candidate_a',
      provenance: {
        operation: 'content-matrix-post',
        provider: 'anthropic',
        model: 'creative-model',
        inputFingerprint: 'b'.repeat(64),
        durationMs: 1250,
        promptTokens: 120,
        completionTokens: 80,
        estimatedCostUsd: 0.04,
      },
      runtimeAudit: {
        authorityFingerprint: 'a'.repeat(64),
        verdict: 'ready_for_human_review',
        deterministicChecks: [{ id: 'heading-contract', result: 'passed' }],
      },
    });
    expect(JSON.stringify(result.runtimeAudit)).not.toContain('Sensitive runtime detail');
    expect(JSON.stringify(result.runtimeAudit)).not.toContain('evidence-private');
  });

  it.each([
    {
      label: 'missing preview authority',
      matrixItem: item({ auditReport: null }),
      generatedPost: post(),
    },
    {
      label: 'stale preview fingerprint',
      matrixItem: item({
        previewTarget: {
          workspaceId: 'ws-1', matrixId: 'matrix-1', cellId: 'cell-1', effectiveInputFingerprint: 'old',
        } as MatrixGenerationItem['previewTarget'],
        auditReport: {
          verdict: 'ready_for_human_review', deterministicChecks: [], modelFindings: [],
          humanRequiredChecks: [], revisionCount: 0, auditedAt: approvedAt, unresolvedRequirementIds: [],
        },
      }),
      generatedPost: post(),
    },
    {
      label: 'missing durable provenance',
      matrixItem: item({
        previewTarget: {
          workspaceId: 'ws-1', matrixId: 'matrix-1', cellId: 'cell-1', effectiveInputFingerprint: 'a'.repeat(64),
        } as MatrixGenerationItem['previewTarget'],
        auditReport: {
          verdict: 'ready_for_human_review', deterministicChecks: [], modelFindings: [],
          humanRequiredChecks: [], revisionCount: 0, auditedAt: approvedAt, unresolvedRequirementIds: [],
        },
      }),
      generatedPost: post({ generationProvenance: null }),
    },
    {
      label: 'post changed after audit',
      matrixItem: item({
        previewTarget: {
          workspaceId: 'ws-1', matrixId: 'matrix-1', cellId: 'cell-1', effectiveInputFingerprint: 'a'.repeat(64),
        } as MatrixGenerationItem['previewTarget'],
        auditReport: {
          verdict: 'ready_for_human_review', deterministicChecks: [], modelFindings: [],
          humanRequiredChecks: [], revisionCount: 0, auditedAt: approvedAt, unresolvedRequirementIds: [],
        },
      }),
      generatedPost: post({ updatedAt: '2026-07-20T12:00:01.000Z' }),
    },
  ])('fails closed for candidate $label', ({ matrixItem, generatedPost }) => {
    expect(() => qualifyMatrixBenchmarkCandidate({
      workspaceId: 'ws-1',
      itemId: 'item-1',
      postId: 'post-1',
      anonymousLabel: 'candidate_a',
      usage: { promptTokens: 1, completionTokens: 1, estimatedCostUsd: 0 },
    }, {
      getMatrixGenerationItem: () => matrixItem,
      getPost: () => generatedPost,
    })).toThrow(ContentQualityBenchmarkSourceError);
  });

  it('rejects unblinded labels and invalid caller-supplied usage metrics', () => {
    const matrixItem = item({
      previewTarget: {
        workspaceId: 'ws-1', matrixId: 'matrix-1', cellId: 'cell-1', effectiveInputFingerprint: 'a'.repeat(64),
      } as MatrixGenerationItem['previewTarget'],
      auditReport: {
        verdict: 'ready_for_human_review', deterministicChecks: [], modelFindings: [],
        humanRequiredChecks: [], revisionCount: 0, auditedAt: approvedAt, unresolvedRequirementIds: [],
      },
    });
    const generatedPost = post({
      generationProvenance: {
        runId: 'run', operation: 'op', provider: 'anthropic', model: 'model', inputFingerprint: 'b'.repeat(64),
        startedAt: approvedAt, completedAt: approvedAt,
      },
    });
    const readers = {
      getMatrixGenerationItem: () => matrixItem,
      getPost: () => generatedPost,
    };
    expect(() => qualifyMatrixBenchmarkCandidate({
      workspaceId: 'ws-1', itemId: 'item-1', postId: 'post-1', anonymousLabel: 'anthropic',
      usage: { promptTokens: 1, completionTokens: 1, estimatedCostUsd: 0 },
    }, readers)).toThrow(ContentQualityBenchmarkSourceError);
    expect(() => qualifyMatrixBenchmarkCandidate({
      workspaceId: 'ws-1', itemId: 'item-1', postId: 'post-1', anonymousLabel: 'candidate_a',
      usage: { promptTokens: -1, completionTokens: 1, estimatedCostUsd: 0 },
    }, readers)).toThrow(ContentQualityBenchmarkSourceError);
  });

  it.each([
    { label: 'invalid post timestamp', postOverrides: { updatedAt: 'not-a-date' } },
    {
      label: 'invalid audit timestamp',
      itemOverrides: {
        auditReport: {
          verdict: 'ready_for_human_review', deterministicChecks: [], modelFindings: [],
          humanRequiredChecks: [], revisionCount: 0, auditedAt: 'not-a-date', unresolvedRequirementIds: [],
        },
      },
    },
    {
      label: 'invalid provenance timestamp',
      postOverrides: {
        generationProvenance: {
          runId: 'run', operation: 'op', provider: 'anthropic', model: 'model', inputFingerprint: 'b'.repeat(64),
          startedAt: 'not-a-date', completedAt: approvedAt,
        },
      },
    },
  ])('rejects a candidate with $label', ({ itemOverrides = {}, postOverrides = {} }) => {
    const matrixItem = item({
      previewTarget: {
        workspaceId: 'ws-1', matrixId: 'matrix-1', cellId: 'cell-1', effectiveInputFingerprint: 'a'.repeat(64),
      } as MatrixGenerationItem['previewTarget'],
      auditReport: {
        verdict: 'ready_for_human_review', deterministicChecks: [], modelFindings: [],
        humanRequiredChecks: [], revisionCount: 0, auditedAt: approvedAt, unresolvedRequirementIds: [],
      },
      ...itemOverrides,
    });
    const generatedPost = post({
      generationProvenance: {
        runId: 'run', operation: 'op', provider: 'anthropic', model: 'model', inputFingerprint: 'b'.repeat(64),
        startedAt: approvedAt, completedAt: approvedAt,
      },
      ...postOverrides,
    });
    expect(() => qualifyMatrixBenchmarkCandidate({
      workspaceId: 'ws-1', itemId: 'item-1', postId: 'post-1', anonymousLabel: 'candidate_a',
      usage: { promptTokens: 1, completionTokens: 1, estimatedCostUsd: 0 },
    }, {
      getMatrixGenerationItem: () => matrixItem,
      getPost: () => generatedPost,
    })).toThrow(ContentQualityBenchmarkSourceError);
  });

  it('exports only explicitly selected approved copy sections in caller order', () => {
    const rows = new Map([
      ['section-a', copySection('section-a')],
      ['section-b', copySection('section-b', { updatedAt: '2026-07-21T12:00:00.000Z' })],
    ]);
    const result = qualifyApprovedCopySections({
      kind: 'approved_copy_sections',
      workspaceId: 'ws-1',
      entryId: 'entry-1',
      sectionIds: ['section-b', 'section-a'],
    }, { getCopySection: (_workspaceId, sectionId) => rows.get(sectionId) ?? null });

    expect(result.referenceHtml.indexOf('section-b')).toBeLessThan(result.referenceHtml.indexOf('section-a'));
    expect(result.reference).toMatchObject({
      approvalKind: 'human_approved',
      approvedAt: '2026-07-21T12:00:00.000Z',
      sourceRevision: 5,
    });
  });

  it.each([
    copySection('section-a', { status: 'client_review' }),
    copySection('section-a', { generatedCopy: '  ' }),
    copySection('section-a', { workspaceId: 'ws-2' }),
    copySection('section-a', { entryId: 'entry-2' }),
  ])('rejects copy sections that are not explicitly approved and scoped', section => {
    expect(() => qualifyApprovedCopySections({
      kind: 'approved_copy_sections',
      workspaceId: 'ws-1',
      entryId: 'entry-1',
      sectionIds: ['section-a'],
    }, { getCopySection: () => section })).toThrow(ContentQualityBenchmarkSourceError);
  });

  it('rejects an empty runtime section selection instead of exporting an entry', () => {
    expect(() => qualifyApprovedCopySections({
      kind: 'approved_copy_sections',
      workspaceId: 'ws-1',
      entryId: 'entry-1',
      sectionIds: [] as unknown as readonly [string, ...string[]],
    }, { getCopySection: () => copySection('unused') })).toThrow(ContentQualityBenchmarkSourceError);
  });

  it('requires local operator attestation and never accepts a URL-shaped fetch input', () => {
    const result = qualifyOperatorCuratedPage({
      kind: 'operator_curated_page',
      sourceId: 'local-approved-page-1',
      html: '<main><h1>Approved locally supplied copy</h1></main>',
      attestation: {
        statement: CONTENT_QUALITY_BENCHMARK_OPERATOR_ATTESTATION,
        approvedAt,
      },
    });
    expect(result.reference.approvalKind).toBe('operator_attested');
    expect(result.referenceHtml).toContain('Approved locally supplied copy');
    expect('url' in result).toBe(false);
  });

  it('rejects missing operator attestation', () => {
    expect(() => qualifyOperatorCuratedPage({
      kind: 'operator_curated_page',
      sourceId: 'local-approved-page-1',
      html: '<p>Copy</p>',
      attestation: {
        statement: 'not attested' as typeof CONTENT_QUALITY_BENCHMARK_OPERATOR_ATTESTATION,
        approvedAt,
      },
    })).toThrow(ContentQualityBenchmarkSourceError);
  });
});
