import type {
  BrandDeliverable,
} from '../../../../shared/types/brand-engine.js';
import type {
  BrandGenerationCommand,
  BrandGenerationEffectCursor,
  BrandGenerationEffectEvent,
  PersistedBrandGenerationRun,
} from '../../../../shared/types/brand-generation.js';
import { addActivityOnce } from '../../../activity-log.js';
import { broadcastToWorkspace } from '../../../broadcast.js';
import { clearIntelligenceCache } from '../../../intelligence/cache-clear.js';
import { createLogger } from '../../../logger.js';
import { recordPaidCallOnce } from '../../../mcp/paid-call-counter.js';
import { BRAND_IDENTITY_UPDATED_PAYLOAD, WS_EVENTS } from '../../../ws-events.js';
import {
  brandGenerationAcceptedEffectKey,
  brandGenerationArtifactEffectKey,
  brandGenerationCompletedEffectKey,
  getBrandGenerationCommand,
  getBrandGenerationEffectEvent,
  listPendingBrandGenerationEffectEvents,
  markBrandGenerationEffectApplied,
  markBrandGenerationEffectFailed,
} from './repository.js';

const log = createLogger('brand-generation-effects');
const DRAIN_PAGE_SIZE = 100;
export const BRAND_GENERATION_EFFECT_RETRY_INTERVAL_MS = 60 * 1000;
export const BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE = 100;

let retryDrainCursor: BrandGenerationEffectCursor | undefined;
let retryDrainInFlight = false;
let retryDrainInterval: ReturnType<typeof setInterval> | null = null;

export interface BrandGenerationEffectDependencies {
  getEvent: typeof getBrandGenerationEffectEvent;
  listPending: typeof listPendingBrandGenerationEffectEvents;
  getCommand: typeof getBrandGenerationCommand;
  markApplied: typeof markBrandGenerationEffectApplied;
  markFailed: typeof markBrandGenerationEffectFailed;
  addActivityOnce: typeof addActivityOnce;
  recordPaidCallOnce: typeof recordPaidCallOnce;
  broadcastToWorkspace: typeof broadcastToWorkspace;
  clearIntelligenceCache: typeof clearIntelligenceCache;
  now: () => Date;
}

const DEFAULT_DEPENDENCIES: BrandGenerationEffectDependencies = {
  getEvent: getBrandGenerationEffectEvent,
  listPending: listPendingBrandGenerationEffectEvents,
  getCommand: getBrandGenerationCommand,
  markApplied: markBrandGenerationEffectApplied,
  markFailed: markBrandGenerationEffectFailed,
  addActivityOnce,
  recordPaidCallOnce,
  broadcastToWorkspace,
  clearIntelligenceCache,
  now: () => new Date(),
};

function dependencies(
  overrides?: Partial<BrandGenerationEffectDependencies>,
): BrandGenerationEffectDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function boundedError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Brand generation effect dispatch failed';
  let result = '';
  for (const character of raw) {
    if (new TextEncoder().encode(result + character).byteLength > 512) break;
    result += character;
  }
  return result;
}

function activityActor(command: BrandGenerationCommand) {
  return {
    id: command.actor.actorId,
    name: command.actor.actorLabel,
  };
}

function commandContext(command: BrandGenerationCommand) {
  return {
    commandId: command.id,
    jobId: command.jobId,
    commandKind: command.kind,
    ...(command.mcpExecutionContext ? {
      mcpRequestId: command.mcpExecutionContext.requestId,
      mcpToolName: command.mcpExecutionContext.toolName,
      mcpCaller: command.mcpExecutionContext,
    } : {}),
  };
}

function requireCommand(
  event: BrandGenerationEffectEvent,
  deps: BrandGenerationEffectDependencies,
): BrandGenerationCommand {
  const command = deps.getCommand(event.workspaceId, event.runId, event.commandId);
  if (!command) throw new Error('Brand generation effect command was not found');
  return command;
}

function applyEvent(
  event: BrandGenerationEffectEvent,
  deps: BrandGenerationEffectDependencies,
): void {
  const command = requireCommand(event, deps);
  if (event.kind === 'command_accepted') {
    const definitions = {
      start: {
        type: 'brand_generation_started' as const,
        title: 'Started grounded brand generation',
        description: 'Accepted a version-bound brand generation run for background processing.',
      },
      resume: {
        type: 'brand_generation_resumed' as const,
        title: 'Resumed grounded brand generation',
        description: 'Unlocked dependent brand generation with an exact finalized voice snapshot.',
      },
      revision: {
        type: 'brand_generation_revision_started' as const,
        title: 'Started brand deliverable revision',
        description: 'Accepted one review-directed, version-bound brand deliverable revision.',
      },
    };
    const definition = definitions[command.kind];
    deps.addActivityOnce({
      effectKey: event.effectKey,
      workspaceId: event.workspaceId,
      type: definition.type,
      title: definition.title,
      description: definition.description,
      metadata: { runId: event.runId, ...commandContext(command) },
      actor: activityActor(command),
      createdAt: event.createdAt,
    });
    if (command.mcpExecutionContext) {
      deps.recordPaidCallOnce(
        `mcp:brand-generation:accepted-command:${command.jobId}`,
        1,
        event.workspaceId,
      );
    }
    return;
  }

  if (event.kind === 'artifact_committed') {
    deps.addActivityOnce({
      effectKey: event.effectKey,
      workspaceId: event.workspaceId,
      type: 'brand_deliverable_generated',
      title: `Generated ${event.payload.deliverableType.replace(/_/g, ' ')}`,
      description: 'Grounded brand generation produced a draft that passed its automatic review gates.',
      metadata: {
        runId: event.runId,
        ...commandContext(command),
        deliverableId: event.payload.deliverableId,
        deliverableType: event.payload.deliverableType,
        deliverableVersion: event.payload.deliverableVersion,
      },
      actor: activityActor(command),
      createdAt: event.createdAt,
    });
    deps.broadcastToWorkspace(
      event.workspaceId,
      WS_EVENTS.BRAND_IDENTITY_UPDATED,
      BRAND_IDENTITY_UPDATED_PAYLOAD,
    );
    deps.clearIntelligenceCache(event.workspaceId);
    deps.broadcastToWorkspace(event.workspaceId, WS_EVENTS.INTELLIGENCE_CACHE_UPDATED, {
      workspaceId: event.workspaceId,
      invalidatedAt: deps.now().toISOString(),
    });
    return;
  }

  deps.addActivityOnce({
    effectKey: event.effectKey,
    workspaceId: event.workspaceId,
    type: 'brand_generation_completed',
    title: 'Completed grounded brand generation',
    description: `The automatic workflow stopped with status ${event.payload.status.replace(/_/g, ' ')}.`,
    metadata: {
      runId: event.runId,
      ...commandContext(command),
      status: event.payload.status,
      counts: event.payload.counts,
    },
    actor: activityActor(command),
    createdAt: event.createdAt,
  });
}

function dispatchEvent(
  event: BrandGenerationEffectEvent,
  deps: BrandGenerationEffectDependencies,
): boolean {
  if (event.appliedAt) return true;
  const attemptedAt = deps.now().toISOString();
  try {
    applyEvent(event, deps);
    deps.markApplied(event.workspaceId, event.effectKey, attemptedAt);
    return true;
  } catch (error) {
    const message = boundedError(error);
    try {
      deps.markFailed(event.workspaceId, event.effectKey, message, attemptedAt);
    } catch (markError) {
      log.error({ err: markError, effectKey: event.effectKey }, 'failed to record brand generation effect failure');
    }
    log.warn({ err: error, effectKey: event.effectKey }, 'brand generation effect remains pending');
    return false;
  }
}

/** Non-throwing worker/service boundary for one durable effect. */
export function dispatchBrandGenerationEffectByKey(
  effectKey: string,
  overrides?: Partial<BrandGenerationEffectDependencies>,
): boolean {
  const deps = dependencies(overrides);
  try {
    const event = deps.getEvent(effectKey);
    if (!event) {
      log.error({ effectKey }, 'brand generation effect event was not found');
      return false;
    }
    return dispatchEvent(event, deps);
  } catch (error) {
    log.error({ err: error, effectKey }, 'brand generation effect dispatch could not start');
    return false;
  }
}

export interface BrandGenerationEffectDrainSummary {
  scanned: number;
  applied: number;
  failed: number;
}

export interface BrandGenerationEffectRetryDrainSummary
  extends BrandGenerationEffectDrainSummary {
  skipped: boolean;
}

/** Keyset-paginated startup drain; a poison event cannot starve later rows. */
export function drainBrandGenerationEffectOutbox(
  overrides?: Partial<BrandGenerationEffectDependencies>,
): BrandGenerationEffectDrainSummary {
  const deps = dependencies(overrides);
  const summary: BrandGenerationEffectDrainSummary = { scanned: 0, applied: 0, failed: 0 };
  let cursor: BrandGenerationEffectCursor | undefined;
  while (true) {
    const events = deps.listPending(DRAIN_PAGE_SIZE, cursor);
    for (const event of events) {
      summary.scanned += 1;
      if (dispatchEvent(event, deps)) summary.applied += 1;
      else summary.failed += 1;
      cursor = { sequence: event.sequence };
    }
    if (events.length < DRAIN_PAGE_SIZE) break;
  }
  if (summary.scanned > 0) log.info(summary, 'brand generation effect outbox drained');
  return summary;
}

/**
 * Bounded recurring drain. The cursor is retained between ticks so a poison
 * prefix cannot permanently starve later effects; once the tail is reached,
 * the next tick wraps to the oldest still-pending row.
 */
export function runBrandGenerationEffectRetryDrain(
  overrides?: Partial<BrandGenerationEffectDependencies>,
): BrandGenerationEffectRetryDrainSummary {
  if (retryDrainInFlight) {
    log.warn('Brand generation effect retry drain already in progress — skipping cycle');
    return { scanned: 0, applied: 0, failed: 0, skipped: true };
  }

  retryDrainInFlight = true;
  const summary: BrandGenerationEffectRetryDrainSummary = {
    scanned: 0,
    applied: 0,
    failed: 0,
    skipped: false,
  };
  try {
    const deps = dependencies(overrides);
    let events = deps.listPending(
      BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE,
      retryDrainCursor,
    );

    // A retained cursor may be beyond the current tail after prior rows were
    // applied. Wrap in the same tick so retries do not lose an interval.
    if (events.length === 0 && retryDrainCursor) {
      retryDrainCursor = undefined;
      events = deps.listPending(BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE);
    }

    for (const event of events) {
      summary.scanned += 1;
      if (dispatchEvent(event, deps)) summary.applied += 1;
      else summary.failed += 1;
    }

    if (events.length === BRAND_GENERATION_EFFECT_RETRY_BATCH_SIZE) {
      retryDrainCursor = { sequence: events[events.length - 1]!.sequence };
    } else {
      retryDrainCursor = undefined;
    }

    if (summary.scanned > 0) {
      log.info(summary, 'brand generation effect retry batch drained');
    }
  } catch (error) {
    log.error({ err: error }, 'brand generation effect retry drain failed');
  } finally {
    retryDrainInFlight = false;
  }
  return summary;
}

/** Idempotent registry lifecycle hook for the bounded same-process retry. */
export function startBrandGenerationEffectRetryCron(): void {
  if (retryDrainInterval) return;
  retryDrainInterval = setInterval(() => {
    runBrandGenerationEffectRetryDrain();
  }, BRAND_GENERATION_EFFECT_RETRY_INTERVAL_MS);
  retryDrainInterval.unref?.();
  log.info(
    { intervalMs: BRAND_GENERATION_EFFECT_RETRY_INTERVAL_MS },
    'brand generation effect retry cron started',
  );
}

/** Idempotent registry lifecycle hook; the exhaustive boot drain remains separate. */
export function stopBrandGenerationEffectRetryCron(): void {
  if (retryDrainInterval) {
    clearInterval(retryDrainInterval);
    retryDrainInterval = null;
  }
  retryDrainCursor = undefined;
}

/** Compatibility wrappers keep call sites small while dispatching only durable events. */
export function applyBrandGenerationCommandAcceptedEffects(
  command: BrandGenerationCommand,
): void {
  dispatchBrandGenerationEffectByKey(brandGenerationAcceptedEffectKey(command.id));
}

export function applyBrandGenerationArtifactCommittedEffects(
  _run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
  deliverable: BrandDeliverable,
  itemId?: string,
): void {
  const boundItemId = itemId ?? command.itemId;
  if (!boundItemId) {
    log.error({ commandId: command.id }, 'artifact effect requires its durable item id');
    return;
  }
  dispatchBrandGenerationEffectByKey(
    brandGenerationArtifactEffectKey(command.id, boundItemId, deliverable.version),
  );
}

export function applyBrandGenerationCompletedEffects(
  _run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
): void {
  dispatchBrandGenerationEffectByKey(brandGenerationCompletedEffectKey(command.id));
}
