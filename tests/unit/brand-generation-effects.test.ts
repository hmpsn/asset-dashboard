import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BrandGenerationCommand,
  BrandGenerationEffectEvent,
} from '../../shared/types/brand-generation.js';
import {
  BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE,
  dispatchBrandGenerationEffectByKey,
  drainBrandGenerationEffectOutbox,
  runBrandGenerationEffectRetryDrain,
  startBrandGenerationEffectRetryCron,
  stopBrandGenerationEffectRetryCron,
  type BrandGenerationEffectDependencies,
} from '../../server/domains/brand/generation/effects.js';
import { WS_EVENTS } from '../../server/ws-events.js';

const NOW = '2026-07-14T12:00:00.000Z';

function command(mcp = true): BrandGenerationCommand {
  return {
    id: 'command-1',
    runId: 'run-1',
    workspaceId: 'ws-1',
    kind: 'start',
    idempotencyKey: 'start-key',
    requestFingerprint: 'a'.repeat(64),
    requestSnapshot: {
      schemaVersion: 1,
      kind: 'start',
      command: {
        workspaceId: 'ws-1',
        intakeRevisionId: 'intake-1',
        expectedIntakeRevision: 1,
        expectedIntakeFingerprint: 'b'.repeat(64),
        selection: { kind: 'preset', preset: 'full_brand_system' },
        budget: {
          maxProviderCalls: 114,
          maxInputTokens: 5_000_000,
          maxOutputTokens: 250_000,
          maxEstimatedCostMicros: 100_000_000,
          maxConcurrency: 3,
        },
      },
    },
    itemId: null,
    expectedRunRevision: null,
    expectedItemRevision: null,
    expectedDeliverableVersion: null,
    priorItemStatus: null,
    jobId: 'job-1',
    result: {
      runId: 'run-1',
      runRevision: 0,
      jobId: 'job-1',
      selectionCount: 1,
      estimate: {
        providerCalls: 6,
        inputTokens: 10_000,
        outputTokens: 5_000,
        estimatedCostMicros: 500_000,
        maxConcurrency: 1,
      },
      dashboardUrl: '/ws/ws-1/brand',
    },
    actor: { actorType: 'mcp', actorId: 'key-1', actorLabel: 'Automation key' },
    mcpExecutionContext: mcp ? {
      requestId: 'request-1',
      toolName: 'start_brand_deliverable_generation',
      targetWorkspaceId: 'ws-1',
      caller: {
        kind: 'workspace_key',
        scope: 'ws-1',
        workspaceId: 'ws-1',
        keyId: 'key-1',
        keyLabel: 'Automation key',
      },
    } : null,
    createdAt: NOW,
  };
}

function acceptedEvent(sequence = 1): BrandGenerationEffectEvent {
  return {
    sequence,
    effectKey: `accepted:command-${sequence}`,
    workspaceId: 'ws-1',
    runId: 'run-1',
    commandId: 'command-1',
    itemId: null,
    kind: 'command_accepted',
    payload: { schemaVersion: 1, kind: 'command_accepted' },
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    appliedAt: null,
    createdAt: NOW,
  };
}

function dependencies(
  event: BrandGenerationEffectEvent,
  overrides: Partial<BrandGenerationEffectDependencies> = {},
): BrandGenerationEffectDependencies {
  return {
    getEvent: vi.fn(() => event),
    listPending: vi.fn(() => []),
    getCommand: vi.fn(() => command()),
    markApplied: vi.fn(() => ({ ...event, appliedAt: NOW, attemptCount: 1, lastAttemptAt: NOW })),
    markFailed: vi.fn(() => ({ ...event, attemptCount: 1, lastAttemptAt: NOW, lastError: 'failed' })),
    addActivityOnce: vi.fn(() => ({
      id: 'activity-1',
      workspaceId: 'ws-1',
      type: 'brand_generation_started',
      title: 'Started grounded brand generation',
      createdAt: NOW,
    })),
    recordPaidCallOnce: vi.fn(() => ({ count: 1 })),
    broadcastToWorkspace: vi.fn(),
    clearIntelligenceCache: vi.fn(() => 1),
    now: () => new Date(NOW),
    ...overrides,
  } as BrandGenerationEffectDependencies;
}

describe('brand generation transactional effect outbox', () => {
  beforeEach(() => {
    stopBrandGenerationEffectRetryCron();
  });

  afterEach(() => {
    stopBrandGenerationEffectRetryCron();
    vi.useRealTimers();
  });

  it('dispatches accepted activity and durable MCP metering from the command context', () => {
    const event = acceptedEvent();
    const deps = dependencies(event);

    expect(dispatchBrandGenerationEffectByKey(event.effectKey, deps)).toBe(true);
    expect(deps.addActivityOnce).toHaveBeenCalledWith(expect.objectContaining({
      effectKey: event.effectKey,
      workspaceId: 'ws-1',
      metadata: expect.objectContaining({
        commandId: 'command-1',
        mcpRequestId: 'request-1',
        mcpCaller: command().mcpExecutionContext,
      }),
    }));
    expect(deps.recordPaidCallOnce).toHaveBeenCalledWith(
      'mcp:brand-generation:accepted-command:job-1',
      1,
      'ws-1',
    );
    expect(deps.markApplied).toHaveBeenCalledWith('ws-1', event.effectKey, NOW);
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it('keeps a failed effect pending without throwing into the source workflow', () => {
    const event = acceptedEvent();
    const deps = dependencies(event, {
      addActivityOnce: vi.fn(() => { throw new Error('broadcast unavailable'); }),
    });

    expect(dispatchBrandGenerationEffectByKey(event.effectKey, deps)).toBe(false);
    expect(deps.markFailed).toHaveBeenCalledWith(
      'ws-1',
      event.effectKey,
      'broadcast unavailable',
      NOW,
    );
    expect(deps.markApplied).not.toHaveBeenCalled();
  });

  it('dispatches artifact activity, brand invalidation, cache clear, and intelligence invalidation', () => {
    const event: BrandGenerationEffectEvent = {
      ...acceptedEvent(),
      effectKey: 'artifact:command-1:item-1:2',
      kind: 'artifact_committed',
      itemId: 'item-1',
      payload: {
        schemaVersion: 1,
        kind: 'artifact_committed',
        deliverableId: 'deliverable-1',
        deliverableType: 'mission',
        deliverableVersion: 2,
        deliverableStatus: 'draft',
      },
    };
    const deps = dependencies(event);

    expect(dispatchBrandGenerationEffectByKey(event.effectKey, deps)).toBe(true);
    expect(deps.clearIntelligenceCache).toHaveBeenCalledWith('ws-1');
    expect(deps.broadcastToWorkspace).toHaveBeenNthCalledWith(
      1,
      'ws-1',
      WS_EVENTS.BRAND_IDENTITY_UPDATED,
      {},
    );
    expect(deps.broadcastToWorkspace).toHaveBeenNthCalledWith(
      2,
      'ws-1',
      WS_EVENTS.INTELLIGENCE_CACHE_UPDATED,
      { workspaceId: 'ws-1', invalidatedAt: NOW },
    );
  });

  it('uses stable activity and paid-meter keys across an at-least-once retry', () => {
    const event = acceptedEvent();
    const deps = dependencies(event);

    expect(dispatchBrandGenerationEffectByKey(event.effectKey, deps)).toBe(true);
    expect(dispatchBrandGenerationEffectByKey(event.effectKey, deps)).toBe(true);
    const activityInputs = vi.mocked(deps.addActivityOnce).mock.calls.map(call => call[0]);
    const paidInputs = vi.mocked(deps.recordPaidCallOnce).mock.calls;
    expect(activityInputs).toHaveLength(2);
    expect(activityInputs[0]!.effectKey).toBe(activityInputs[1]!.effectKey);
    expect(paidInputs).toHaveLength(2);
    expect(paidInputs[0]).toEqual(paidInputs[1]);
  });

  it('advances past a poison first event while draining more than one page', () => {
    const events = Array.from({ length: 101 }, (_, index) => acceptedEvent(index + 1));
    const failedKey = events[0]!.effectKey;
    const base = dependencies(events[0]!, {
      getCommand: vi.fn(() => command(false)),
      addActivityOnce: vi.fn(input => {
        if (input.effectKey === failedKey) throw new Error('poison');
        return {
          id: `activity-${input.effectKey}`,
          workspaceId: input.workspaceId,
          type: input.type,
          title: input.title,
          createdAt: input.createdAt,
        };
      }),
    });
    base.listPending = vi.fn((limit, cursor) => events
      .filter(event => event.sequence > (cursor?.sequence ?? 0))
      .slice(0, limit));

    expect(drainBrandGenerationEffectOutbox(base)).toEqual({
      scanned: 101,
      applied: 100,
      failed: 1,
    });
    expect(base.markFailed).toHaveBeenCalledWith('ws-1', failedKey, 'poison', NOW);
    expect(base.markApplied).toHaveBeenCalledTimes(100);
    expect(base.listPending).toHaveBeenCalledTimes(2);
  });

  it('retries a same-process transient failure on the next bounded cycle', () => {
    const event = acceptedEvent();
    let activityAttempts = 0;
    const deps = dependencies(event, {
      listPending: vi.fn(() => [event]),
      addActivityOnce: vi.fn(input => {
        activityAttempts += 1;
        if (activityAttempts === 1) throw new Error('temporary broadcast outage');
        return {
          id: `activity-${input.effectKey}`,
          workspaceId: input.workspaceId,
          type: input.type,
          title: input.title,
          createdAt: input.createdAt,
        };
      }),
    });

    expect(runBrandGenerationEffectRetryDrain(deps)).toEqual({
      scanned: 1,
      applied: 0,
      failed: 1,
      skipped: false,
    });
    expect(runBrandGenerationEffectRetryDrain(deps)).toEqual({
      scanned: 1,
      applied: 1,
      failed: 0,
      skipped: false,
    });
    expect(deps.markFailed).toHaveBeenCalledTimes(1);
    expect(deps.markApplied).toHaveBeenCalledTimes(1);
  });

  it('bounds each recurring cycle and advances beyond a poison event', () => {
    const events = Array.from(
      { length: BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE + 1 },
      (_, index) => acceptedEvent(index + 1),
    );
    const failedKey = events[0]!.effectKey;
    const deps = dependencies(events[0]!, {
      getCommand: vi.fn(() => command(false)),
      addActivityOnce: vi.fn(input => {
        if (input.effectKey === failedKey) throw new Error('poison');
        return {
          id: `activity-${input.effectKey}`,
          workspaceId: input.workspaceId,
          type: input.type,
          title: input.title,
          createdAt: input.createdAt,
        };
      }),
    });
    deps.listPending = vi.fn((limit, cursor) => events
      .filter(event => event.sequence > (cursor?.sequence ?? 0))
      .slice(0, limit));

    expect(runBrandGenerationEffectRetryDrain(deps)).toEqual({
      scanned: BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE,
      applied: BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE - 1,
      failed: 1,
      skipped: false,
    });
    expect(runBrandGenerationEffectRetryDrain(deps)).toEqual({
      scanned: 1,
      applied: 1,
      failed: 0,
      skipped: false,
    });
    expect(deps.markApplied).toHaveBeenCalledWith(
      'ws-1',
      events[BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE]!.effectKey,
      NOW,
    );
    expect(deps.listPending).toHaveBeenNthCalledWith(
      1,
      BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE,
      undefined,
    );
    expect(deps.listPending).toHaveBeenNthCalledWith(
      2,
      BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE,
      { sequence: BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE },
    );
  });

  it('skips a reentrant retry cycle while the active drain is in flight', () => {
    const event = acceptedEvent();
    let nestedSummary: ReturnType<typeof runBrandGenerationEffectRetryDrain> | undefined;
    const deps = dependencies(event);
    deps.listPending = vi.fn(() => {
      nestedSummary = runBrandGenerationEffectRetryDrain(deps);
      return [];
    });

    expect(runBrandGenerationEffectRetryDrain(deps)).toEqual({
      scanned: 0,
      applied: 0,
      failed: 0,
      skipped: false,
    });
    expect(nestedSummary).toEqual({
      scanned: 0,
      applied: 0,
      failed: 0,
      skipped: true,
    });
    expect(deps.listPending).toHaveBeenCalledTimes(1);
  });

  it('starts and stops the retry interval idempotently', () => {
    vi.useFakeTimers();

    startBrandGenerationEffectRetryCron();
    startBrandGenerationEffectRetryCron();
    expect(vi.getTimerCount()).toBe(1);

    stopBrandGenerationEffectRetryCron();
    stopBrandGenerationEffectRetryCron();
    expect(vi.getTimerCount()).toBe(0);
  });
});
