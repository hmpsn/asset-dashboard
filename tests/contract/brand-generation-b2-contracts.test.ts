import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  AI_OPERATION_REGISTRY,
  getAIOperationCachePolicy,
} from '../../server/ai-operation-registry.js';
import {
  BRAND_GENERATION_ATTEMPT_TRANSITIONS,
  BRAND_GENERATION_ITEM_TRANSITIONS,
  BRAND_GENERATION_RUN_TRANSITIONS,
} from '../../server/state-machines.js';
import {
  BACKGROUND_JOB_METADATA,
  BACKGROUND_JOB_TYPES,
} from '../../shared/types/background-jobs.js';
import {
  BRAND_GENERATION_ATTEMPT_STAGES,
  BRAND_GENERATION_ATTEMPT_STATUSES,
  BRAND_GENERATION_ATOMIC_TARGETS,
  BRAND_GENERATION_CONTRACT_VERSION,
  BRAND_GENERATION_LIMITS,
  type BrandGenerationAttempt,
  type BrandGenerationCommand,
  type BrandGenerationItem,
  type BrandGenerationRun,
  type PersistedBrandGenerationRun,
  type StartBrandGenerationCommandSnapshot,
} from '../../shared/types/brand-generation.js';

type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
type AssertFalse<T extends false> = T;
type AssertTrue<T extends true> = T;

describe('B2 brand-generation contracts', () => {
  it('separates internal execution identity from the public run projection', () => {
    type PublicLeaksIdempotency = HasKey<BrandGenerationRun, 'idempotencyKey'>;
    type PublicLeaksMcpContext = HasKey<BrandGenerationRun, 'mcpExecutionContext'>;
    type PersistedHasIdempotency = HasKey<PersistedBrandGenerationRun, 'idempotencyKey'>;
    type PersistedHasMcpContext = HasKey<PersistedBrandGenerationRun, 'mcpExecutionContext'>;
    const publicDoesNotLeakIdempotency: AssertFalse<PublicLeaksIdempotency> = false;
    const publicDoesNotLeakMcpContext: AssertFalse<PublicLeaksMcpContext> = false;
    const persistedKeepsIdempotency: AssertTrue<PersistedHasIdempotency> = true;
    const persistedKeepsMcpContext: AssertTrue<PersistedHasMcpContext> = true;

    expect({
      publicDoesNotLeakIdempotency,
      publicDoesNotLeakMcpContext,
      persistedKeepsIdempotency,
      persistedKeepsMcpContext,
    }).toEqual({
      publicDoesNotLeakIdempotency: false,
      publicDoesNotLeakMcpContext: false,
      persistedKeepsIdempotency: true,
      persistedKeepsMcpContext: true,
    });
  });

  it('locks bounded paging, paid-work ceilings, and attempt vocabularies', () => {
    expect(BRAND_GENERATION_CONTRACT_VERSION).toBe(1);
    expect(BRAND_GENERATION_LIMITS.defaultItemPageSize).toBe(25);
    expect(BRAND_GENERATION_LIMITS.maxItemPageSize).toBe(100);
    expect(BRAND_GENERATION_LIMITS.maxTargets).toBe(
      BRAND_GENERATION_ATOMIC_TARGETS.length,
    );
    expect(BRAND_GENERATION_LIMITS.maxProviderCalls).toBe(
      BRAND_GENERATION_LIMITS.maxTargets * 6,
    );
    expect(BRAND_GENERATION_LIMITS.maxConcurrency).toBeGreaterThan(0);
    expect(BRAND_GENERATION_ATTEMPT_STAGES).toEqual([
      'preflight',
      'voice_foundation_generation',
      'dependent_generation',
      'deterministic_audit',
      'model_audit',
      'revision',
    ]);
    expect(BRAND_GENERATION_ATTEMPT_STATUSES).toEqual([
      'running',
      'completed',
      'failed',
      'cancelled',
    ]);
  });

  it('makes foundation and durable artifact persistence mutually exclusive', () => {
    type Foundation = Extract<BrandGenerationItem, { target: 'voice_foundation' }>;
    type Durable = Exclude<BrandGenerationItem, { target: 'voice_foundation' }>;
    const foundationContentIsNull: AssertTrue<Foundation['content'] extends null ? true : false> = true;
    const foundationExpectationIsNull: AssertTrue<Foundation['artifactExpectation'] extends null ? true : false> = true;
    const durableFoundationIsNull: AssertTrue<Durable['foundationDraft'] extends null ? true : false> = true;
    expect({ foundationContentIsNull, foundationExpectationIsNull, durableFoundationIsNull })
      .toEqual({
        foundationContentIsNull: true,
        foundationExpectationIsNull: true,
        durableFoundationIsNull: true,
      });
  });

  it('discriminates attempt checkpoints and keeps request correlation out of replay identity', () => {
    type FoundationAttempt = Extract<BrandGenerationAttempt, {
      stage: 'voice_foundation_generation';
    }>;
    type DurableAttempt = Extract<BrandGenerationAttempt, { stage: 'dependent_generation' }>;
    type AuditAttempt = Extract<BrandGenerationAttempt, { stage: 'model_audit' }>;
    type FoundationOutput = NonNullable<FoundationAttempt['output']>;
    type DurableOutput = NonNullable<DurableAttempt['output']>;
    type AuditOutput = NonNullable<AuditAttempt['output']>;
    const assertions = {
      attemptHasRunId: true as AssertTrue<HasKey<BrandGenerationAttempt, 'runId'>>,
      attemptHasCommandId: true as AssertTrue<HasKey<BrandGenerationAttempt, 'commandId'>>,
      foundationContentIsNull: true as AssertTrue<FoundationOutput['content'] extends null ? true : false>,
      durableFoundationIsNull: true as AssertTrue<DurableOutput['foundationDraft'] extends null ? true : false>,
      auditHasReport: true as AssertTrue<HasKey<AuditOutput, 'auditReport'>>,
      snapshotOmitsIdempotency: false as AssertFalse<HasKey<StartBrandGenerationCommandSnapshot, 'idempotencyKey'>>,
      snapshotOmitsMcpContext: false as AssertFalse<HasKey<StartBrandGenerationCommandSnapshot, 'mcpExecutionContext'>>,
      snapshotOmitsActor: false as AssertFalse<HasKey<StartBrandGenerationCommandSnapshot, 'createdBy'>>,
      storedResultOmitsReplayMarker: false as AssertFalse<HasKey<BrandGenerationCommand['result'], 'existing'>>,
    };
    expect(assertions).toEqual({
      attemptHasRunId: true,
      attemptHasCommandId: true,
      foundationContentIsNull: true,
      durableFoundationIsNull: true,
      auditHasReport: true,
      snapshotOmitsIdempotency: false,
      snapshotOmitsMcpContext: false,
      snapshotOmitsActor: false,
      storedResultOmitsReplayMarker: false,
    });
  });

  it('registers truthful run/item/attempt lifecycle maps', () => {
    expect(BRAND_GENERATION_RUN_TRANSITIONS.awaiting_review).toContain('running');
    expect(BRAND_GENERATION_RUN_TRANSITIONS.cancelled).toEqual([]);
    expect(BRAND_GENERATION_ITEM_TRANSITIONS.ready_for_human_review).toEqual(
      expect.arrayContaining(['revising', 'conflict']),
    );
    expect(BRAND_GENERATION_ITEM_TRANSITIONS.revising).toContain('ready_for_human_review');
    expect(BRAND_GENERATION_ITEM_TRANSITIONS.revising).toContain('changes_requested');
    expect(BRAND_GENERATION_ITEM_TRANSITIONS.approved).toEqual([]);
    expect(BRAND_GENERATION_ATTEMPT_TRANSITIONS.running).toEqual([
      'completed',
      'failed',
      'cancelled',
    ]);
  });

  it('registers one cancellable domain-store job with a bounded summary result', () => {
    expect(BACKGROUND_JOB_TYPES.BRAND_DELIVERABLE_GENERATION)
      .toBe('brand-deliverable-generation');
    expect(BACKGROUND_JOB_METADATA[BACKGROUND_JOB_TYPES.BRAND_DELIVERABLE_GENERATION])
      .toEqual({
        label: 'Brand Deliverable Generation',
        description: 'Generates a grounded brand foundation or reviewed brand deliverable suite.',
        cancellable: true,
        resultBehavior: 'domain-store-and-result',
        class: 'user',
      });
  });

  it('registers three background-only structured operations without completed-response reuse', () => {
    for (const id of [
      'brand-deliverable-generate',
      'brand-deliverable-refine',
      'brand-deliverable-audit',
    ] as const) {
      expect(AI_OPERATION_REGISTRY[id]).toMatchObject({
        domain: 'brand-engine',
        outputMode: 'json',
        researchMode: 'required',
        executionMode: 'background-only',
        retryPolicy: 'none',
        defaultMaxRetries: 0,
      });
      expect(getAIOperationCachePolicy(id)).toEqual({ mode: 'none' });
    }
  });

  it('allocates additive normalized migration 187 with tenant-safe identities', () => {
    const sql = readFileSync(
      new URL('../../server/db/migrations/187-brand-generation-runs.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain('CREATE TABLE brand_generation_runs');
    expect(sql).toContain('CREATE TABLE brand_generation_items');
    expect(sql).toContain('CREATE TABLE brand_generation_commands');
    expect(sql).toContain('CREATE TABLE brand_generation_attempts');
    expect(sql).toContain('UNIQUE (workspace_id, intake_revision_id, idempotency_key)');
    expect(sql).toContain('UNIQUE (run_id, target)');
    expect(sql).not.toContain('DROP TABLE');
  });
});
