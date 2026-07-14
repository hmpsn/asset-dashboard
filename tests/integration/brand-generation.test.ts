import { createHash, randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BRAND_DELIVERABLE_TYPES,
  type VoiceDNA,
  type VoiceGuardrails,
} from '../../shared/types/brand-engine.js';
import { brandIntakePayloadSchema } from '../../shared/types/brand-intake-schemas.js';
import type {
  BrandGenerationCandidateAttemptOutput,
  BrandGenerationFoundationCandidateAttemptOutput,
  BrandGenerationItem,
  StartBrandGenerationRequest,
} from '../../shared/types/brand-generation.js';
import { BRAND_GENERATION_ATOMIC_TARGETS } from '../../shared/types/brand-generation.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import type { FinalizedVoiceSnapshot } from '../../shared/types/voice-finalization.js';
import { listDeliverables } from '../../server/brand-identity.js';
import db from '../../server/db/index.js';
import { runBrandGenerationDeterministicAudit } from '../../server/domains/brand/generation/audit.js';
import { reconcileBrandGenerationRunsAfterRestart } from '../../server/domains/brand/generation/recovery.js';
import {
  listBrandGenerationCommandsByJob,
  transitionBrandGenerationRun,
} from '../../server/domains/brand/generation/repository.js';
import {
  getBrandGeneration,
  resumeBrandGeneration,
  startBrandGeneration,
  type BrandGenerationServiceDependencies,
} from '../../server/domains/brand/generation/service.js';
import {
  runBrandGenerationJob,
  type BrandGenerationWorkerDependencies,
} from '../../server/domains/brand/generation/worker.js';
import { submitBrandIntake } from '../../server/domains/brand/intake/service.js';
import { finalizeBrandVoice } from '../../server/domains/brand/voice-finalization.js';
import {
  cancelJob,
  clearCompletedJobs,
  getJob,
  recoverInterruptedJobsAfterRestart,
} from '../../server/jobs.js';
import {
  addVoiceSample,
  createVoiceProfile,
  getVoiceProfile,
} from '../../server/voice-calibration.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const OPERATOR = {
  actorType: 'operator' as const,
  actorId: 'brand-generation-integration-operator',
  actorLabel: 'Brand Generation Integration Operator',
};

const MAX_BUDGET = {
  maxProviderCalls: 114,
  maxInputTokens: 5_000_000,
  maxOutputTokens: 250_000,
  maxEstimatedCostMicros: 100_000_000,
  maxConcurrency: 3,
};

const VOICE_DNA: VoiceDNA = {
  personalityTraits: ['Warm and exact'],
  toneSpectrum: {
    formal_casual: 6,
    serious_playful: 4,
    technical_accessible: 8,
  },
  sentenceStyle: 'Short, calm sentences with a clear point.',
  vocabularyLevel: 'Plain language that preserves expertise.',
};

const GUARDRAILS: VoiceGuardrails = {
  forbiddenWords: ['miracle'],
  requiredTerminology: [],
  toneBoundaries: ['Never pressure the reader.'],
  antiPatterns: ['Unsupported superlatives'],
};

interface Fixture {
  seeded: SeededFullWorkspace;
  intake: ReturnType<typeof submitBrandIntake>['revision'];
  voiceSampleId: string;
}

const fixtures: Fixture[] = [];

function createFixture(label: string): Fixture {
  const seeded = seedWorkspace({ tier: 'growth', clientPassword: '' });
  createVoiceProfile(seeded.workspaceId);
  const voiceSample = addVoiceSample(
    seeded.workspaceId,
    `${label} explains the useful truth, then lets the customer decide.`,
    'body',
    'manual',
  );
  const intake = submitBrandIntake({
    workspaceId: seeded.workspaceId,
    payload: brandIntakePayloadSchema.parse({
      schemaVersion: 1,
      business: {
        businessName: `${label} Studio`,
        industry: 'Professional services',
        description: 'An evidence-led strategy studio for growing service businesses.',
        services: 'Brand strategy and web strategy',
        locations: 'Chicago',
        differentiators: 'Grounded recommendations and calm senior guidance',
        website: 'https://brand-generation.example',
      },
      audience: {
        primaryAudience: 'Service-business founders',
        painPoints: 'Disconnected positioning and generic copy',
        goals: 'A credible brand system their team can use',
        objections: 'They worry strategy will become shelfware',
        buyingStage: 'consideration',
        secondaryAudience: 'Marketing leads',
      },
      brand: {
        tone: 'Warm, direct, and specific',
        personality: ['Clear', 'Assured', 'Human'],
        avoidWords: 'Miracle and guaranteed',
        contentFormats: ['Website copy', 'Sales collateral'],
        existingExamples: 'Explain the useful truth, then let the customer decide.',
      },
      competitors: {
        competitors: 'Large generalist agencies',
        whatTheyDoBetter: 'They have larger production teams',
        whatYouDoBetter: 'Senior strategy stays close to implementation',
        referenceUrls: 'https://competitor.example/about',
      },
      authenticSamples: [{
        id: `${label.toLowerCase().replace(/\s+/g, '-')}-intake-sample`,
        kind: 'client_written',
        content: 'We make the complicated decision feel clear.',
        context: 'headline',
        sourceRef: {
          sourceType: 'client_submission',
          sourceId: `${label.toLowerCase().replace(/\s+/g, '-')}-submission`,
          capturedAt: '2026-07-14T11:55:00.000Z',
        },
      }],
    }),
    source: 'admin',
    submitter: OPERATOR,
  }).revision;
  const fixture = { seeded, intake, voiceSampleId: voiceSample.id };
  fixtures.push(fixture);
  return fixture;
}

function serviceDependencies(
  queueBrandGenerationJob = vi.fn(),
  enabled = true,
): Partial<BrandGenerationServiceDependencies> {
  return {
    isFeatureEnabled: () => enabled,
    queueBrandGenerationJob,
  };
}

function startRequest(
  fixture: Fixture,
  selection: StartBrandGenerationRequest['selection'],
  voice?: FinalizedVoiceSnapshot,
  idempotencyKey = `brand-start-${randomUUID()}`,
): StartBrandGenerationRequest {
  const common = {
    workspaceId: fixture.seeded.workspaceId,
    intakeRevisionId: fixture.intake.id,
    expectedIntakeRevision: fixture.intake.revision,
    expectedIntakeFingerprint: fixture.intake.fingerprint,
    selection,
    budget: MAX_BUDGET,
    idempotencyKey,
    createdBy: OPERATOR,
    mcpExecutionContext: null,
  };
  return voice
    ? {
        ...common,
        expectedVoiceVersion: voice.voiceVersion,
        expectedVoiceFingerprint: voice.fingerprint,
      } as StartBrandGenerationRequest
    : common as StartBrandGenerationRequest;
}

function finalizeVoice(
  fixture: Fixture,
  voiceDNA: VoiceDNA = VOICE_DNA,
  guardrails: VoiceGuardrails = GUARDRAILS,
): FinalizedVoiceSnapshot {
  const profile = getVoiceProfile(fixture.seeded.workspaceId);
  if (!profile) throw new Error('Expected the voice profile fixture to exist.');
  return finalizeBrandVoice({
    workspaceId: fixture.seeded.workspaceId,
    expectedProfileRevision: profile.revision,
    voiceDNA,
    guardrails,
    contextModifiers: [],
    anchorSelectors: [{ kind: 'voice_sample', voiceSampleId: fixture.voiceSampleId }],
    calibrationSelections: [],
    idempotencyKey: `voice-finalize-${randomUUID()}`,
    finalizedBy: OPERATOR,
    executionActor: OPERATOR,
  }).snapshot;
}

function foundationCandidate(
  input: Parameters<BrandGenerationWorkerDependencies['generateCandidate']>[0],
): BrandGenerationFoundationCandidateAttemptOutput {
  const requirements = input.preflight.attemptOutput.requirements;
  const placeholders = input.preflight.attemptOutput.placeholders;
  const placeholderText = placeholders.map(item => item.token).join(' ');
  const draft = {
    schemaVersion: 1 as const,
    summary: ['A warm, exact voice that makes complex choices clear.', placeholderText]
      .filter(Boolean)
      .join(' '),
    voiceDNA: VOICE_DNA,
    guardrails: GUARDRAILS,
    contextModifiers: [],
    evidenceRequirementIds: requirements.map(requirement => requirement.id),
  };
  return {
    kind: 'foundation_candidate',
    content: null,
    foundationDraft: {
      ...draft,
      fingerprint: createHash('sha256').update(JSON.stringify(draft)).digest('hex'),
    },
    claims: [{
      text: 'A warm, exact voice is the proposed creative direction.',
      classification: 'creative_proposal',
      evidenceKeys: [],
      sourceRefs: [],
    }],
    requirements,
    placeholders,
  };
}

function deliverableCandidate(
  input: Parameters<BrandGenerationWorkerDependencies['generateCandidate']>[0],
): BrandGenerationCandidateAttemptOutput {
  const target = input.frozenInput.inputSnapshot.target;
  if (target === 'voice_foundation') return foundationCandidate(input);
  const base = target === 'naming'
    ? 'Northstar Works is an unverified creative naming proposal. Trademark, domain, legal, and cultural checks have not been verified.'
    : `A grounded ${target.replace(/_/g, ' ')} creative proposal for the brand.`;
  const placeholderText = input.preflight.attemptOutput.placeholders
    .map(item => item.token)
    .join(' ');
  const content = [base, placeholderText].filter(Boolean).join(' ');
  return {
    kind: 'deliverable_candidate',
    content,
    foundationDraft: null,
    claims: [{
      text: content,
      classification: 'creative_proposal',
      evidenceKeys: [],
      sourceRefs: [],
    }],
    requirements: input.preflight.attemptOutput.requirements,
    placeholders: input.preflight.attemptOutput.placeholders,
  };
}

function fakeOperationResult<T>(
  output: T,
  fingerprint: string,
  operation: string,
) {
  const timestamp = new Date().toISOString();
  const runId = `fake-${randomUUID()}`;
  return {
    output,
    provenance: {
      runId,
      operation,
      provider: 'anthropic' as const,
      model: 'integration-fixture',
      inputFingerprint: fingerprint,
      startedAt: timestamp,
      completedAt: timestamp,
    },
    budgetUsage: {
      providerCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
      estimatedCostMicros: 10,
    },
    tokens: { prompt: 100, completion: 20, total: 120 },
    execution: {
      runId,
      operation,
      provider: 'anthropic' as const,
      model: 'integration-fixture',
      attempts: 1,
      cacheOutcome: 'bypass' as const,
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 0,
    },
    effectiveInputFingerprint: fingerprint,
  };
}

function successfulWorkerDependencies(): BrandGenerationWorkerDependencies {
  return {
    generateCandidate: vi.fn(async input => {
      const fingerprint = input.effectivePrompt!.effectiveInputFingerprint;
      await input.reserveProviderDispatch({
        operation: 'brand-deliverable-generate',
        provider: 'anthropic',
        fallback: false,
        providerCalls: 1,
        inputTokens: 100,
        outputTokens: 20,
        estimatedCostMicros: 10,
        effectiveInputFingerprint: fingerprint,
      });
      return fakeOperationResult(
        deliverableCandidate(input),
        fingerprint,
        'brand-deliverable-generate',
      );
    }),
    refineCandidate: vi.fn(async () => {
      throw new Error('A review-ready integration candidate must not be automatically revised.');
    }),
    auditCandidate: vi.fn(async input => {
      const fingerprint = input.effectivePrompt!.effectiveInputFingerprint;
      await input.reserveProviderDispatch({
        operation: 'brand-deliverable-audit',
        provider: 'openai',
        fallback: false,
        providerCalls: 1,
        inputTokens: 50,
        outputTokens: 10,
        estimatedCostMicros: 5,
        effectiveInputFingerprint: fingerprint,
      });
      const output = {
        kind: 'audit' as const,
        auditReport: runBrandGenerationDeterministicAudit({
          frozenInput: input.frozenInput,
          preflight: input.preflight,
          candidate: input.candidate,
          revisionCount: input.revisionCount,
          now: () => new Date(),
        }),
      };
      return fakeOperationResult(
        output,
        fingerprint,
        'brand-deliverable-audit',
      );
    }),
  };
}

function rowCount(table: string, workspaceId: string): number {
  if (table === 'brand_generation_attempts') {
    return (db.prepare(`
      SELECT COUNT(*) AS count
      FROM brand_generation_attempts attempt
      INNER JOIN brand_generation_items item ON item.id = attempt.item_id
      WHERE item.workspace_id = ?
    `).get(workspaceId) as { count: number }).count;
  }
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`)
    .get(workspaceId) as { count: number }).count;
}

function expectSummaryOnlyJob(jobId: string, forbiddenContent: string): void {
  const job = getJob(jobId);
  expect(job).toMatchObject({
    type: BACKGROUND_JOB_TYPES.BRAND_DELIVERABLE_GENERATION,
  });
  const result = job?.result as Record<string, unknown> | undefined;
  expect(result).toBeDefined();
  expect(Object.keys(result ?? {}).sort()).toEqual(['counts', 'runId', 'terminalStatus']);
  expect(JSON.stringify(result)).not.toContain(forbiddenContent);
}

/**
 * Vitest intentionally disables SQLite foreign keys for legacy fixture
 * compatibility, so deleting the workspace cannot be treated as cleanup for
 * this cross-domain integration fixture. Remove the immutable parent first so
 * the intake/finalization history guards permit fixture teardown, then delete
 * every generated child row in FK-safe leaf-to-root order.
 */
function cleanupFixture(fixture: Fixture): void {
  const workspaceId = fixture.seeded.workspaceId;
  const jobIds = (db.prepare('SELECT id FROM jobs WHERE workspace_id = ?').all(workspaceId) as Array<{ id: string }>)
    .map(row => row.id);
  for (const jobId of jobIds) cancelJob(jobId);
  clearCompletedJobs({ workspaceId });

  db.transaction(() => {
    fixture.seeded.cleanup();

    db.prepare(`
      DELETE FROM brand_generation_attempts
      WHERE run_id IN (
        SELECT id FROM brand_generation_runs WHERE workspace_id = ?
      )
    `).run(workspaceId);
    db.prepare('DELETE FROM brand_generation_commands WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_generation_items WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_generation_runs WHERE workspace_id = ?').run(workspaceId);

    db.prepare(`
      DELETE FROM brand_identity_versions
      WHERE deliverable_id IN (
        SELECT id FROM brand_identity_deliverables WHERE workspace_id = ?
      )
    `).run(workspaceId);
    db.prepare('DELETE FROM brand_identity_deliverables WHERE workspace_id = ?').run(workspaceId);

    db.prepare('DELETE FROM voice_finalization_authorizations WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM voice_profile_finalizations WHERE workspace_id = ?').run(workspaceId);
    db.prepare(`
      DELETE FROM voice_samples
      WHERE voice_profile_id IN (
        SELECT id FROM voice_profiles WHERE workspace_id = ?
      )
    `).run(workspaceId);
    db.prepare(`
      DELETE FROM voice_calibration_sessions
      WHERE voice_profile_id IN (
        SELECT id FROM voice_profiles WHERE workspace_id = ?
      )
    `).run(workspaceId);
    db.prepare('DELETE FROM voice_profiles WHERE workspace_id = ?').run(workspaceId);

    db.prepare('DELETE FROM brand_intake_revisions WHERE workspace_id = ?').run(workspaceId);
    // Defensive fallback for a persisted job not loaded into the in-memory
    // cache; terminal cached jobs were already removed by clearCompletedJobs.
    db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
  })();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  for (const fixture of fixtures.splice(0)) {
    cleanupFixture(fixture);
  }
});

describe('durable brand deliverable generation', () => {
  it('repairs the real initJobs restart-error shape only before the command dispatches', () => {
    const fixture = createFixture('Restart Repair');
    const voice = finalizeVoice(fixture);
    const request = startRequest(
      fixture,
      { kind: 'atomic', target: 'mission' },
      voice,
      'restart-repair-start',
    );
    const initialQueue = vi.fn();
    const started = startBrandGeneration(
      request,
      serviceDependencies(initialQueue),
    );
    expect(getJob(started.jobId)).toMatchObject({ status: 'pending' });
    expect(initialQueue).toHaveBeenCalledWith(started.jobId);

    expect(recoverInterruptedJobsAfterRestart()).toBeGreaterThanOrEqual(1);
    expect(getJob(started.jobId)).toMatchObject({
      status: 'error',
      message: 'Interrupted by server restart',
      error: 'Server restarted — job interrupted',
    });

    const repairedQueue = vi.fn();
    const recovery = reconcileBrandGenerationRunsAfterRestart({
      queueJob: repairedQueue,
    });

    expect(recovery).toMatchObject({
      repairedJobs: 1,
      terminalizedRuns: 0,
      errors: 0,
    });
    expect(repairedQueue).toHaveBeenCalledOnce();
    expect(repairedQueue).toHaveBeenCalledWith(started.jobId);
    expect(getJob(started.jobId)).toMatchObject({
      status: 'pending',
      workspaceId: fixture.seeded.workspaceId,
    });
    expect(rowCount('jobs', fixture.seeded.workspaceId)).toBe(1);

    const replay = startBrandGeneration(
      request,
      serviceDependencies(repairedQueue, false),
    );
    expect(replay).toEqual({ ...started, existing: true });
    expect(repairedQueue).toHaveBeenCalledOnce();
  });

  it('reconciles a terminal durable run restart tombstone without mutating its items', () => {
    const fixture = createFixture('Terminal Restart Reconcile');
    const voice = finalizeVoice(fixture);
    const started = startBrandGeneration(
      startRequest(
        fixture,
        { kind: 'atomic', target: 'mission' },
        voice,
        'terminal-restart-reconcile',
      ),
      serviceDependencies(),
    );
    const running = transitionBrandGenerationRun({
      workspaceId: fixture.seeded.workspaceId,
      runId: started.runId,
      expectedRevision: started.runRevision,
      nextStatus: 'running',
      nextStage: 'dependent_generation',
      currentJobId: started.jobId,
    });
    const command = listBrandGenerationCommandsByJob(
      fixture.seeded.workspaceId,
      started.jobId,
    )[0]!;
    transitionBrandGenerationRun({
      workspaceId: fixture.seeded.workspaceId,
      runId: started.runId,
      expectedRevision: running.revision,
      nextStatus: 'completed',
      nextStage: 'complete',
      // Simulate the narrow crash window before generic-job finalization.
      currentJobId: started.jobId,
      completedAt: new Date().toISOString(),
      completionCommandId: command.id,
    });
    const itemBefore = db.prepare(`
      SELECT status, revision, content, audit_report_json, provenance_json
      FROM brand_generation_items
      WHERE workspace_id = ? AND run_id = ?
    `).get(fixture.seeded.workspaceId, started.runId);

    recoverInterruptedJobsAfterRestart();
    expect(getJob(started.jobId)).toMatchObject({ status: 'error' });
    const recovery = reconcileBrandGenerationRunsAfterRestart({ queueJob: vi.fn() });

    expect(recovery).toMatchObject({
      repairedJobs: 0,
      reconciledTerminalJobs: 1,
      terminalizedRuns: 0,
      errors: 0,
    });
    expect(getJob(started.jobId)).toMatchObject({
      status: 'done',
      result: { runId: started.runId, terminalStatus: 'completed' },
    });
    expect(db.prepare(`
      SELECT status, revision, content, audit_report_json, provenance_json
      FROM brand_generation_items
      WHERE workspace_id = ? AND run_id = ?
    `).get(fixture.seeded.workspaceId, started.runId)).toEqual(itemBefore);
  });

  it('runs the full bootstrap, human voice finalization, resume, and exact-replay lifecycle', async () => {
    const fixture = createFixture('Full System');
    const queued = vi.fn();
    const initialRequest = startRequest(
      fixture,
      { kind: 'preset', preset: 'full_brand_system' },
      undefined,
      'full-system-start',
    );

    const started = startBrandGeneration(
      initialRequest,
      serviceDependencies(queued),
    );

    expect(started).toMatchObject({
      existing: false,
      selectionCount: 1,
      estimate: {
        providerCalls: 114,
        inputTokens: 4_727_808,
        outputTokens: 247_000,
        estimatedCostMicros: 31_049_040,
        maxConcurrency: 3,
      },
    });
    expect(rowCount('brand_generation_runs', fixture.seeded.workspaceId)).toBe(1);
    expect(rowCount('brand_generation_items', fixture.seeded.workspaceId)).toBe(1);
    expect(queued).toHaveBeenCalledExactlyOnceWith(started.jobId);

    const workerDependencies = successfulWorkerDependencies();
    await runBrandGenerationJob(started.jobId, workerDependencies);

    const paused = getBrandGeneration({
      workspaceId: fixture.seeded.workspaceId,
      runId: started.runId,
    });
    const foundation = paused.itemPage.items[0];
    expect(paused.run).toMatchObject({
      status: 'awaiting_review',
      stage: 'awaiting_voice_finalization',
      counts: { selected: 1, readyForHumanReview: 1 },
      budget: { estimate: started.estimate },
    });
    expect(foundation).toMatchObject({
      target: 'voice_foundation',
      status: 'ready_for_human_review',
      content: null,
      committedDeliverableId: null,
      committedDeliverableVersion: null,
    });
    expect(foundation?.foundationDraft).toMatchObject({
      voiceDNA: VOICE_DNA,
      guardrails: GUARDRAILS,
    });
    expect(listDeliverables(fixture.seeded.workspaceId)).toEqual([]);
    expect(getJob(started.jobId)).toMatchObject({
      status: 'done',
      result: { runId: started.runId, terminalStatus: 'awaiting_review' },
    });
    expectSummaryOnlyJob(started.jobId, 'A warm, exact voice');

    vi.setSystemTime(new Date('2026-07-14T12:01:00.000Z'));
    const voice = finalizeVoice(
      fixture,
      foundation!.foundationDraft!.voiceDNA,
      foundation!.foundationDraft!.guardrails,
    );
    expect(voice.finalizedAt > foundation!.completedAt!).toBe(true);

    const resumeRequest = {
      workspaceId: fixture.seeded.workspaceId,
      runId: started.runId,
      expectedRunRevision: paused.run.revision,
      expectedVoiceVersion: voice.voiceVersion,
      expectedVoiceFingerprint: voice.fingerprint,
      idempotencyKey: 'full-system-resume',
      resumedBy: OPERATOR,
      mcpExecutionContext: null,
    };
    const resumed = resumeBrandGeneration(
      resumeRequest,
      serviceDependencies(queued),
    );

    expect(resumed).toMatchObject({
      existing: false,
      selectionCount: BRAND_DELIVERABLE_TYPES.length,
      estimate: {
        providerCalls: BRAND_DELIVERABLE_TYPES.length * 6,
        maxConcurrency: 3,
      },
    });
    expect(rowCount('brand_generation_items', fixture.seeded.workspaceId))
      .toBe(BRAND_GENERATION_ATOMIC_TARGETS.length);

    // Resume inherits the foundation's paid history, but repair eligibility is
    // scoped to this exact zero-attempt resume command rather than cumulative
    // run usage.
    expect(recoverInterruptedJobsAfterRestart()).toBeGreaterThanOrEqual(1);
    const resumeRecoveryQueue = vi.fn();
    expect(reconcileBrandGenerationRunsAfterRestart({
      queueJob: resumeRecoveryQueue,
    })).toMatchObject({ repairedJobs: 1, terminalizedRuns: 0, errors: 0 });
    expect(resumeRecoveryQueue).toHaveBeenCalledWith(resumed.jobId);

    await runBrandGenerationJob(resumed.jobId, workerDependencies);

    const completed = getBrandGeneration({
      workspaceId: fixture.seeded.workspaceId,
      runId: started.runId,
    });
    expect(completed.run).toMatchObject({
      status: 'completed',
      stage: 'complete',
      counts: {
        selected: BRAND_GENERATION_ATOMIC_TARGETS.length,
        readyForHumanReview: BRAND_GENERATION_ATOMIC_TARGETS.length,
        conflicts: 0,
        failed: 0,
      },
      voiceReadiness: {
        state: 'finalized',
        snapshot: {
          voiceVersion: voice.voiceVersion,
          fingerprint: voice.fingerprint,
        },
      },
    });
    expect(completed.itemPage.items).toHaveLength(BRAND_GENERATION_ATOMIC_TARGETS.length);
    expect(new Set(completed.itemPage.items.map(item => item.target)))
      .toEqual(new Set(BRAND_GENERATION_ATOMIC_TARGETS));
    const dependentItems = completed.itemPage.items
      .filter((item): item is Exclude<BrandGenerationItem, { target: 'voice_foundation' }> => (
        item.target !== 'voice_foundation'
      ));
    expect(dependentItems).toHaveLength(BRAND_DELIVERABLE_TYPES.length);
    expect(dependentItems.every(item => ( // every-ok -- exact non-empty count pinned above
        item.status === 'ready_for_human_review'
        && item.committedDeliverableId !== null
        && item.committedDeliverableVersion === 1
      ))).toBe(true);

    const deliverables = listDeliverables(fixture.seeded.workspaceId);
    expect(deliverables).toHaveLength(BRAND_DELIVERABLE_TYPES.length);
    expect(new Set(deliverables.map(item => item.deliverableType)))
      .toEqual(new Set(BRAND_DELIVERABLE_TYPES));
    expect(deliverables.every( // every-ok -- exact non-empty count pinned above
      item => item.status === 'draft' && item.version === 1,
    )).toBe(true);
    expect(getJob(resumed.jobId)).toMatchObject({
      status: 'done',
      result: { runId: started.runId, terminalStatus: 'completed' },
    });
    expectSummaryOnlyJob(resumed.jobId, 'Northstar Works');

    const countsBeforeReplay = {
      runs: rowCount('brand_generation_runs', fixture.seeded.workspaceId),
      items: rowCount('brand_generation_items', fixture.seeded.workspaceId),
      commands: rowCount('brand_generation_commands', fixture.seeded.workspaceId),
      attempts: rowCount('brand_generation_attempts', fixture.seeded.workspaceId),
      jobs: rowCount('jobs', fixture.seeded.workspaceId),
    };
    const startReplay = startBrandGeneration(
      initialRequest,
      serviceDependencies(queued, false),
    );
    const resumeReplay = resumeBrandGeneration(
      resumeRequest,
      serviceDependencies(queued, false),
    );
    expect(startReplay).toEqual({ ...started, existing: true });
    expect(resumeReplay).toEqual({ ...resumed, existing: true });
    expect(queued).toHaveBeenCalledTimes(2);
    expect({
      runs: rowCount('brand_generation_runs', fixture.seeded.workspaceId),
      items: rowCount('brand_generation_items', fixture.seeded.workspaceId),
      commands: rowCount('brand_generation_commands', fixture.seeded.workspaceId),
      attempts: rowCount('brand_generation_attempts', fixture.seeded.workspaceId),
      jobs: rowCount('jobs', fixture.seeded.workspaceId),
    }).toEqual(countsBeforeReplay);

    // A pruned generic job after paid checkpoints must never be reconstructed
    // by an exact replay; the durable run remains the source of truth.
    clearCompletedJobs({ workspaceId: fixture.seeded.workspaceId });
    expect(rowCount('jobs', fixture.seeded.workspaceId)).toBe(0);
    expect(startBrandGeneration(
      initialRequest,
      serviceDependencies(queued, false),
    )).toEqual({ ...started, existing: true });
    expect(resumeBrandGeneration(
      resumeRequest,
      serviceDependencies(queued, false),
    )).toEqual({ ...resumed, existing: true });
    expect(rowCount('jobs', fixture.seeded.workspaceId)).toBe(0);
    expect(queued).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('fails a required model-audit stage without creating a phantom deliverable', async () => {
    const fixture = createFixture('Audit Failure');
    const voice = finalizeVoice(fixture);
    const request = startRequest(
      fixture,
      { kind: 'atomic', target: 'mission' },
      voice,
      'audit-failure-start',
    );
    const started = startBrandGeneration(request, serviceDependencies());
    const dependencies = successfulWorkerDependencies();
    dependencies.auditCandidate = vi.fn(async input => {
      await input.reserveProviderDispatch({
        operation: 'brand-deliverable-audit',
        provider: 'openai',
        fallback: false,
        providerCalls: 1,
        inputTokens: 50,
        outputTokens: 10,
        estimatedCostMicros: 5,
        effectiveInputFingerprint: input.effectivePrompt!.effectiveInputFingerprint,
      });
      throw new Error('required model audit unavailable');
    });

    await runBrandGenerationJob(started.jobId, dependencies);

    const result = getBrandGeneration({
      workspaceId: fixture.seeded.workspaceId,
      runId: started.runId,
    });
    expect(result.run).toMatchObject({
      status: 'failed',
      stage: 'complete',
      counts: { failed: 1, readyForHumanReview: 0 },
    });
    expect(result.itemPage.items).toEqual([
      expect.objectContaining({
        target: 'mission',
        status: 'failed',
        content: null,
        committedDeliverableId: null,
        committedDeliverableVersion: null,
        error: {
          code: 'brand_generation_stage_failed',
          message: 'Brand generation could not complete this item. Review the durable run before retrying.',
          retryable: true,
          stage: 'model_audit',
        },
      }),
    ]);
    expect(listDeliverables(fixture.seeded.workspaceId)).toEqual([]);
    expect(getJob(started.jobId)).toMatchObject({
      status: 'error',
      result: { runId: started.runId, terminalStatus: 'failed' },
    });
    expectSummaryOnlyJob(started.jobId, 'grounded mission creative proposal');
  });

  it('preserves a deliverable created after acceptance and records an honest CAS conflict', async () => {
    const fixture = createFixture('Late Edit');
    const voice = finalizeVoice(fixture);
    const started = startBrandGeneration(
      startRequest(
        fixture,
        { kind: 'atomic', target: 'mission' },
        voice,
        'late-edit-start',
      ),
      serviceDependencies(),
    );

    const humanDeliverableId = `bid_human_${randomUUID().slice(0, 8)}`;
    const dependencies = successfulWorkerDependencies();
    const successfulAudit = dependencies.auditCandidate;
    dependencies.auditCandidate = vi.fn(async input => {
      const audited = await successfulAudit(input);
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO brand_identity_deliverables (
          id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at
        ) VALUES (?, ?, 'mission', ?, 'draft', 1, 'essentials', ?, ?)
      `).run(
        humanDeliverableId,
        fixture.seeded.workspaceId,
        'Human-authored mission that must survive.',
        now,
        now,
      );
      return audited;
    });

    await runBrandGenerationJob(started.jobId, dependencies);

    const result = getBrandGeneration({
      workspaceId: fixture.seeded.workspaceId,
      runId: started.runId,
    });
    expect(result.run).toMatchObject({
      status: 'conflict',
      stage: 'awaiting_operator_review',
      counts: { conflicts: 1, readyForHumanReview: 0 },
    });
    expect(result.itemPage.items).toEqual([
      expect.objectContaining({
        target: 'mission',
        status: 'conflict',
        content: null,
        committedDeliverableId: null,
        committedDeliverableVersion: null,
        error: {
          code: 'deliverable_created',
          message: 'A newer brand deliverable change was preserved. Review and retry explicitly.',
          retryable: true,
          stage: 'artifact_commit',
        },
      }),
    ]);
    expect(listDeliverables(fixture.seeded.workspaceId)).toEqual([
      expect.objectContaining({
        id: humanDeliverableId,
        content: 'Human-authored mission that must survive.',
        version: 1,
      }),
    ]);
    expect(getJob(started.jobId)).toMatchObject({
      status: 'error',
      result: { runId: started.runId, terminalStatus: 'conflict' },
    });
    expectSummaryOnlyJob(started.jobId, 'grounded mission creative proposal');
  });
});
