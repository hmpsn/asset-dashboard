import { afterEach, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import {
  BrandContentOnboardingIdempotencyConflictError,
  BrandContentOnboardingResumeIdempotencyConflictError,
  BrandContentOnboardingRevisionConflictError,
  createBrandContentOnboardingRun,
  getBrandContentOnboardingResumeReplay,
  getBrandContentOnboardingRun,
  transitionBrandContentOnboardingRun,
} from '../../server/domains/brand-content-onboarding/repository.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type {
  BrandContentOnboardingGateEvidence,
} from '../../shared/types/brand-content-onboarding.js';
import type { BrandIntakeRevisionRef } from '../../shared/types/brand-intake.js';

const cleanup: string[] = [];

afterEach(() => {
  for (const workspaceId of cleanup.splice(0)) {
    deleteWorkspace(workspaceId);
    db.prepare('DELETE FROM brand_content_onboarding_runs WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_intake_revisions WHERE workspace_id = ?').run(workspaceId);
  }
});

function seedWorkspace(label: string): {
  workspaceId: string;
  intakeRevision: BrandIntakeRevisionRef;
} {
  const workspaceId = createWorkspace(`${label} ${Date.now()} ${Math.random()}`).id;
  cleanup.push(workspaceId);
  const intakeRevision: BrandIntakeRevisionRef = {
    intakeRevisionId: `intake-${workspaceId}`,
    revision: 1,
    fingerprint: 'a'.repeat(64),
  };
  db.prepare(`
    INSERT INTO brand_intake_revisions (
      id, workspace_id, revision, schema_version, payload_json,
      evidence_resolutions_json, projection_state_json, fingerprint, source,
      submitter_json, mutation_kind, mutation_fingerprint, idempotency_key,
      supersedes_revision_id, created_at
    ) VALUES (?, ?, 1, 1, '{}', '[]',
      '{"preservedCompetitorDomains":[],"intakeOwnedCompetitorDomains":[]}',
      ?, 'admin', '{"actorType":"operator","actorId":"op-test"}',
      'submission', ?, NULL, NULL, ?)
  `).run(
    intakeRevision.intakeRevisionId,
    workspaceId,
    intakeRevision.fingerprint,
    'b'.repeat(64),
    '2026-07-14T00:00:00.000Z',
  );
  return { workspaceId, intakeRevision };
}

function intakeEvidence(
  intakeRevision: BrandIntakeRevisionRef,
): Extract<BrandContentOnboardingGateEvidence, { gate: 'intake_accepted' }> {
  return {
    id: 'evidence-intake-accepted',
    gate: 'intake_accepted',
    intakeRevision,
    recordedBy: { actorType: 'mcp', actorId: 'key-1', actorLabel: 'Automation' },
    recordedAt: '2026-07-14T00:00:00.000Z',
  };
}

function createInput(
  workspaceId: string,
  intakeRevision: BrandIntakeRevisionRef,
  idempotencyKey = 'start-1',
) {
  return {
    workspaceId,
    intakeRevision,
    matrixSelection: [{
      matrixId: 'matrix-1',
      cellId: 'cell-1',
      sourceRevision: { matrixRevision: 1, templateRevision: 2, cellRevision: 3 },
      structuralFingerprint: 'c'.repeat(64),
      previewFingerprint: null,
    }] as const,
    brandBudget: {
      maxProviderCalls: 10,
      maxInputTokens: 10_000,
      maxOutputTokens: 5_000,
      maxEstimatedCostMicros: 10_000,
      maxConcurrency: 1,
    },
    idempotencyKey,
    createdBy: { actorType: 'mcp' as const, actorId: 'key-1', actorLabel: 'Automation' },
    intakeEvidence: intakeEvidence(intakeRevision),
    now: '2026-07-14T00:00:00.000Z',
  };
}

describe('brand content onboarding repository', () => {
  it('persists a restart-safe run and replays the same start input', () => {
    const { workspaceId, intakeRevision } = seedWorkspace('onboarding create');
    const input = createInput(workspaceId, intakeRevision);

    const created = createBrandContentOnboardingRun(input);
    const replayed = createBrandContentOnboardingRun(input);

    expect(created.existing).toBe(false);
    expect(replayed).toEqual({ run: created.run, existing: true });
    expect(getBrandContentOnboardingRun(workspaceId, created.run.id)).toEqual(created.run);
    expect(created.run).toMatchObject({
      workspaceId,
      status: 'intake_ready',
      revision: 0,
      currentGate: 'intake_accepted',
      children: {
        brandRunId: null,
        matrixRunId: null,
        pageApprovals: [],
      },
    });
  });

  it('rejects reuse of a start key for a different selection', () => {
    const { workspaceId, intakeRevision } = seedWorkspace('onboarding start conflict');
    const input = createInput(workspaceId, intakeRevision);
    createBrandContentOnboardingRun(input);

    expect(() => createBrandContentOnboardingRun({
      ...input,
      matrixSelection: [{
        matrixId: 'matrix-1',
        cellId: 'cell-2',
        sourceRevision: { matrixRevision: 1, templateRevision: 2, cellRevision: 3 },
        structuralFingerprint: 'f'.repeat(64),
        previewFingerprint: null,
      }],
    })).toThrow(BrandContentOnboardingIdempotencyConflictError);
  });

  it('advances with optimistic revision protection and persists child references', () => {
    const { workspaceId, intakeRevision } = seedWorkspace('onboarding transition');
    const created = createBrandContentOnboardingRun(createInput(workspaceId, intakeRevision));

    const advanced = transitionBrandContentOnboardingRun({
      workspaceId,
      runId: created.run.id,
      expectedRevision: 0,
      expectedStatus: 'intake_ready',
      nextStatus: 'brand_generating',
      currentGate: null,
      attentionResumeStatus: null,
      children: { brandRunId: 'brand-run-1' },
      resume: {
        idempotencyKey: 'resume-1',
        requestFingerprint: 'd'.repeat(64),
      },
      now: '2026-07-14T00:01:00.000Z',
    });

    expect(advanced.replayed).toBe(false);
    expect(advanced.run).toMatchObject({
      status: 'brand_generating',
      revision: 1,
      children: { brandRunId: 'brand-run-1' },
    });
    expect(() => transitionBrandContentOnboardingRun({
      workspaceId,
      runId: created.run.id,
      expectedRevision: 0,
      expectedStatus: 'intake_ready',
      nextStatus: 'brand_generating',
      currentGate: null,
      attentionResumeStatus: null,
      resume: {
        idempotencyKey: 'resume-stale',
        requestFingerprint: 'e'.repeat(64),
      },
      now: '2026-07-14T00:02:00.000Z',
    })).toThrow(BrandContentOnboardingRevisionConflictError);
  });

  it('replays an identical command after later gates have advanced', () => {
    const { workspaceId, intakeRevision } = seedWorkspace('onboarding resume replay');
    const created = createBrandContentOnboardingRun(createInput(workspaceId, intakeRevision));
    const transition = {
      workspaceId,
      runId: created.run.id,
      expectedRevision: 0,
      expectedStatus: 'intake_ready' as const,
      nextStatus: 'brand_generating' as const,
      currentGate: null,
      attentionResumeStatus: null,
      resume: {
        idempotencyKey: 'resume-1',
        requestFingerprint: 'd'.repeat(64),
      },
      paidJobId: 'brand-child-job-1',
      now: '2026-07-14T00:01:00.000Z',
    };

    const first = transitionBrandContentOnboardingRun(transition);
    expect(transitionBrandContentOnboardingRun(transition)).toEqual({
      run: first.run,
      replayed: true,
    });
    expect(getBrandContentOnboardingResumeReplay(
      workspaceId,
      created.run.id,
      transition.resume.idempotencyKey,
      transition.resume.requestFingerprint,
    )).toEqual({ run: first.run, paidJobId: 'brand-child-job-1' });

    const second = transitionBrandContentOnboardingRun({
      workspaceId,
      runId: created.run.id,
      expectedRevision: first.run.revision,
      expectedStatus: 'brand_generating',
      nextStatus: 'awaiting_voice_review',
      currentGate: 'voice_reviewed',
      attentionResumeStatus: null,
      resume: {
        idempotencyKey: 'resume-2',
        requestFingerprint: 'f'.repeat(64),
      },
      now: '2026-07-14T00:02:00.000Z',
    });
    expect(getBrandContentOnboardingResumeReplay(
      workspaceId,
      created.run.id,
      transition.resume.idempotencyKey,
      transition.resume.requestFingerprint,
    )).toEqual({ run: second.run, paidJobId: 'brand-child-job-1' });
    expect(transitionBrandContentOnboardingRun(transition)).toEqual({
      run: second.run,
      replayed: true,
    });
    expect(() => transitionBrandContentOnboardingRun({
      ...transition,
      resume: { ...transition.resume, requestFingerprint: 'e'.repeat(64) },
    })).toThrow(BrandContentOnboardingResumeIdempotencyConflictError);
  });
});
