import { describe, expect, it } from 'vitest';

import {
  BACKGROUND_JOB_METADATA,
  BACKGROUND_JOB_TYPES,
} from '../../shared/types/background-jobs.js';
import { FEATURE_FLAG_CATALOG } from '../../shared/types/feature-flags.js';
import {
  MATRIX_GENERATION_BATCH_LIMITS,
  MATRIX_GENERATION_SET_AUDIT_VERDICTS,
  MATRIX_GENERATION_SET_FINDING_KINDS,
  type ApproveMatrixPageForPublishReadinessRequest,
  type MatrixGenerationItem,
  type MatrixGenerationRun,
  type StartMatrixGenerationRequest,
} from '../../shared/types/matrix-generation.js';
import { AI_OPERATION_REGISTRY } from '../../server/ai-operation-registry.js';
import { MATRIX_GENERATION_ITEM_TRANSITIONS } from '../../server/state-machines.js';

describe('content matrix generation M3 contracts', () => {
  it('bounds paid batches and keeps set-audit findings typed', () => {
    expect(MATRIX_GENERATION_BATCH_LIMITS).toEqual({
      maxItems: 25,
      maxProviderCalls: 1_250,
      maxInputTokens: 25_000_000,
      maxOutputTokens: 1_000_000,
      maxEstimatedUsd: 150,
      maxConcurrency: 3,
    });
    expect(MATRIX_GENERATION_SET_FINDING_KINDS).toEqual([
      'structural',
      'prose',
      'provenance',
    ]);
    expect(MATRIX_GENERATION_SET_AUDIT_VERDICTS).toEqual([
      'passed',
      'needs_attention',
      'source_correction_required',
    ]);
  });

  it('freezes accepted budget and review evidence on the existing ledger', () => {
    type RunBudget = MatrixGenerationRun['acceptedBudget'];
    type RunSetAudit = MatrixGenerationRun['setAuditReport'];
    type ItemApproval = MatrixGenerationItem['approvalEvidence'];
    type StartBudget = StartMatrixGenerationRequest['acceptedBudget'];
    type HumanApprover = ApproveMatrixPageForPublishReadinessRequest['approvedBy']['actorType'];

    const compileTimeShape: {
      runBudget: RunBudget;
      runSetAudit: RunSetAudit;
      itemApproval: ItemApproval;
      startBudget: StartBudget | null;
      humanApprover: HumanApprover;
    } = {
      runBudget: null,
      runSetAudit: null,
      itemApproval: null,
      startBudget: null,
      humanApprover: 'operator',
    };
    expect(compileTimeShape).toMatchObject({
      runBudget: null,
      runSetAudit: null,
      itemApproval: null,
      humanApprover: 'operator',
    });
  });

  it('registers one cancellable parent job and one schema-validated set audit', () => {
    expect(BACKGROUND_JOB_TYPES.CONTENT_MATRIX_GENERATION).toBe('content-matrix-generation');
    expect(BACKGROUND_JOB_METADATA[BACKGROUND_JOB_TYPES.CONTENT_MATRIX_GENERATION]).toMatchObject({
      label: 'Content Matrix Generation',
      cancellable: true,
      resultBehavior: 'domain-store-and-result',
      class: 'user',
    });
    expect(AI_OPERATION_REGISTRY['content-matrix-set-audit']).toMatchObject({
      outputMode: 'json',
      researchMode: 'required',
      retryPolicy: 'none',
      executionMode: 'background-only',
    });
  });

  it('activates the narrow start flag and permits one set-level disposition', () => {
    expect(FEATURE_FLAG_CATALOG['content-matrix-generation'].lifecycle.status).toBe('active');
    expect(MATRIX_GENERATION_ITEM_TRANSITIONS.ready_for_human_review).toEqual([
      'revising',
      'needs_attention',
    ]);
  });
});
