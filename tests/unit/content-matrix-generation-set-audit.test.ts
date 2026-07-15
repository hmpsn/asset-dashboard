import { describe, expect, it, vi } from 'vitest';

import type { AICallResult } from '../../server/ai.js';
import {
  auditMatrixGenerationSet,
  runDeterministicMatrixGenerationSetAudit,
  type MatrixGenerationSetAuditCandidate,
} from '../../server/domains/content/matrix-generation/set-audit.js';
import type { PersistedGeneratedPost } from '../../shared/types/content.js';
import type {
  MatrixGenerationItem,
  MatrixGenerationPreviewTarget,
} from '../../shared/types/matrix-generation.js';

function candidate(input: {
  id: string;
  plannedUrl: string;
  keyword: string;
  sectionCount?: number;
}): MatrixGenerationSetAuditCandidate {
  const now = '2026-07-14T12:00:00.000Z';
  const previewTarget = {
    plannedUrl: input.plannedUrl,
    targetKeyword: { value: input.keyword },
    evidenceRequirements: [],
    evidenceCapturedAt: now,
    variableValues: {},
    blockManifest: {
      blocks: [
        { id: 'system:introduction', source: 'system' },
        { id: 'body', source: 'template' },
        { id: 'system:conclusion', source: 'system' },
      ],
    },
  } as MatrixGenerationPreviewTarget;
  const item = {
    id: input.id,
    previewTarget,
  } as MatrixGenerationItem;
  const sections = Array.from({ length: input.sectionCount ?? 1 }, (_, index) => ({
    index,
    heading: 'Service details',
    content: '<p>Grounded, useful service information.</p>',
    wordCount: 5,
    targetWordCount: 5,
    keywords: [],
    status: 'done' as const,
  }));
  const post = {
    introduction: '<p>A clear introduction.</p>',
    sections,
    conclusion: '<p>A clear next step.</p>',
  } as PersistedGeneratedPost;
  return { item, post };
}

function aiResult(text: string): AICallResult {
  const now = '2026-07-14T12:00:00.000Z';
  return {
    text,
    tokens: { prompt: 100, completion: 20, total: 120 },
    execution: {
      runId: 'set-audit-run',
      operation: 'content-matrix-set-audit',
      provider: 'openai',
      model: 'gpt-5.4',
      attempts: 1,
      cacheOutcome: 'bypass',
      startedAt: now,
      completedAt: now,
      durationMs: 10,
    },
  };
}

describe('content matrix set audit', () => {
  it('catches structural collisions without flagging a normal service-by-location pair', () => {
    const austin = candidate({
      id: 'item-austin',
      plannedUrl: '/austin/laser-hair-removal',
      keyword: 'laser hair removal Austin',
    });
    const dallas = candidate({
      id: 'item-dallas',
      plannedUrl: '/dallas/laser-hair-removal',
      keyword: 'laser hair removal Dallas',
    });
    expect(runDeterministicMatrixGenerationSetAudit([austin, dallas])).toEqual([]);

    const duplicate = candidate({
      id: 'item-duplicate',
      plannedUrl: '/austin/laser-hair-removal/',
      keyword: 'Austin laser hair removal',
      sectionCount: 0,
    });
    const codes = runDeterministicMatrixGenerationSetAudit([austin, duplicate])
      .map(finding => finding.code);
    expect(codes).toContain('duplicate_planned_url');
    expect(codes).toContain('keyword_cannibalization');
    expect(codes).toContain('block_manifest_coverage');
  });

  it('accepts a bounded prose finding and returns only its selected revision target', async () => {
    const austin = candidate({
      id: 'item-austin',
      plannedUrl: '/austin/seo',
      keyword: 'SEO Austin',
    });
    const dallas = candidate({
      id: 'item-dallas',
      plannedUrl: '/dallas/seo',
      keyword: 'SEO Dallas',
    });
    const callAI = vi.fn().mockResolvedValue(aiResult(JSON.stringify({ findings: [{
      code: 'repetitive_opening',
      kind: 'prose',
      severity: 'warning',
      message: 'The openings are too repetitive.',
      affectedItemIds: ['item-austin'],
      affectedTargetIds: ['item-austin:body'],
      requiresHumanReview: false,
      revisionRecommended: true,
    }] })));

    const result = await auditMatrixGenerationSet({
      workspaceId: 'workspace-1',
      candidates: [austin, dallas],
      passCount: 1,
      dependencies: { callAI },
    });

    expect(result.report.verdict).toBe('needs_attention');
    expect(result.proseRevisionItemIds).toEqual(['item-austin']);
    expect(result.report.modelProvenance?.operation).toBe('content-matrix-set-audit');
    expect(callAI).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'content-matrix-set-audit',
      researchMode: true,
      maxRetries: 0,
    }));
  });

  it('rejects unknown targets and provenance findings proposed for automatic revision', async () => {
    const page = candidate({
      id: 'item-austin',
      plannedUrl: '/austin/seo',
      keyword: 'SEO Austin',
    });
    const invalidFindings = [
      {
        code: 'unknown_target',
        kind: 'prose',
        severity: 'warning',
        message: 'Unknown target.',
        affectedItemIds: ['other-item'],
        affectedTargetIds: ['other-item:body'],
        requiresHumanReview: false,
        revisionRecommended: true,
      },
      {
        code: 'fact_conflict',
        kind: 'provenance',
        severity: 'error',
        message: 'A factual statement conflicts.',
        affectedItemIds: ['item-austin'],
        affectedTargetIds: ['item-austin:body'],
        requiresHumanReview: true,
        revisionRecommended: true,
      },
    ];

    for (const finding of invalidFindings) {
      await expect(auditMatrixGenerationSet({
        workspaceId: 'workspace-1',
        candidates: [page],
        passCount: 1,
        dependencies: {
          callAI: vi.fn().mockResolvedValue(aiResult(JSON.stringify({ findings: [finding] }))),
        },
      })).rejects.toThrow(/unknown item|cannot be auto-revised/i);
    }
  });
});
