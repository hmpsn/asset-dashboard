import { listWorkspaces } from './workspaces.js';
import { isFeatureEnabled } from './feature-flags.js';
import { computeROI } from './roi.js';
import { getROIHighlightsFromOutcomes } from './outcome-tracking.js';
import { assembleSetupReadiness } from './the-issue-readiness.js';
import { createLogger } from './logger.js';
import {
  createIntervalCron,
  runWithWorkspaceSingleFlight,
} from './weekly-workspace-cron.js';
import {
  clearAdminMoneyFrame,
  saveAdminMoneyFrame,
} from './money-frame-store.js';
import type {
  AdminMoneyFrame,
  OutcomeProvenance,
} from '../shared/types/outcome-tracking.js';
import type { ROIData } from './roi.js';

const log = createLogger('money-frame-cron');

const FLAG = 'ui-rebuild-shell';
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RECOVERED_WINS_LIMIT = 10_000;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function finiteMoney(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? roundMoney(value) : 0;
}

export function deriveRecoveredSoFar(workspaceId: string): number {
  const highlights = getROIHighlightsFromOutcomes(workspaceId, RECOVERED_WINS_LIMIT);
  const total = highlights.reduce((sum, highlight) => (
    typeof highlight.attributedValue === 'number' && Number.isFinite(highlight.attributedValue)
      ? sum + highlight.attributedValue
      : sum
  ), 0);
  return finiteMoney(total);
}

function resolveReadTimeProvenance(workspaceId: string, roi: ROIData): OutcomeProvenance {
  try {
    const readiness = assembleSetupReadiness(workspaceId);
    if (readiness) return readiness.resolvedProvenance;
  } catch (err) {
    log.warn({ err, workspaceId }, 'admin money-frame provenance read failed; falling back to ROI verdict/default');
  }
  return roi.outcomeVerdict?.provenance ?? 'estimate_ga4';
}

export interface AssembleAdminMoneyFrameOptions {
  now?: Date;
}

export function assembleAdminMoneyFrame(
  workspaceId: string,
  opts: AssembleAdminMoneyFrameOptions = {},
): AdminMoneyFrame | null {
  let roi: ROIData | null;
  try {
    roi = computeROI(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId }, 'admin money-frame ROI compute failed');
    return null;
  }

  if (!roi) return null;

  let recoveredSoFar: number;
  try {
    recoveredSoFar = deriveRecoveredSoFar(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId }, 'admin money-frame recovered value read failed');
    return null;
  }

  const precomputedAt = (opts.now ?? new Date()).toISOString();
  return {
    valueAtStake: finiteMoney(roi.revenueAtStake),
    recoveredSoFar,
    provenance: resolveReadTimeProvenance(workspaceId, roi),
    precomputedAt,
  };
}

export interface RunAdminMoneyFramePrecomputeOptions {
  now?: Date;
}

export interface RunAdminMoneyFramePrecomputeResult {
  status: 'stored' | 'skipped';
  reason?: string;
  frame?: AdminMoneyFrame;
}

const runningPrecomputes = new Set<string>();

export function runAdminMoneyFramePrecomputeForWorkspace(
  workspaceId: string,
  opts: RunAdminMoneyFramePrecomputeOptions = {},
): RunAdminMoneyFramePrecomputeResult {
  return runWithWorkspaceSingleFlight<RunAdminMoneyFramePrecomputeResult>(
    runningPrecomputes,
    workspaceId,
    () => ({ status: 'skipped', reason: 'already running' }),
    () => runAdminMoneyFramePrecomputeForWorkspaceInner(workspaceId, opts),
  );
}

function runAdminMoneyFramePrecomputeForWorkspaceInner(
  workspaceId: string,
  opts: RunAdminMoneyFramePrecomputeOptions,
): RunAdminMoneyFramePrecomputeResult {
  if (!isFeatureEnabled(FLAG, workspaceId)) {
    return { status: 'skipped', reason: 'flag off' };
  }

  const frame = assembleAdminMoneyFrame(workspaceId, opts);
  if (!frame) {
    clearAdminMoneyFrame(workspaceId);
    return { status: 'skipped', reason: 'no frame' };
  }

  try {
    saveAdminMoneyFrame(workspaceId, frame);
  } catch (err) {
    log.error({ err, workspaceId }, 'admin money-frame persist failed');
    return { status: 'skipped', reason: 'store failed' };
  }

  return { status: 'stored', frame };
}

function tick(now = new Date()): void {
  for (const ws of listWorkspaces()) {
    if (!isFeatureEnabled(FLAG, ws.id)) continue;
    const result = runAdminMoneyFramePrecomputeForWorkspace(ws.id, { now });
    if (result.status === 'skipped' && result.reason !== 'flag off' && result.reason !== 'no frame') {
      log.debug({ workspaceId: ws.id, reason: result.reason }, 'admin money-frame precompute skipped');
    }
  }
}

const adminMoneyFrameCronLifecycle = createIntervalCron({
  startupDelayMs: 120_000,
  intervalMs: CHECK_INTERVAL_MS,
  runStartup: () => {
    try {
      tick();
    } catch (err) {
      log.error({ err }, 'admin money-frame startup tick failed');
    }
  },
  runInterval: () => {
    try {
      tick();
    } catch (err) {
      log.error({ err }, 'admin money-frame tick failed');
    }
  },
  onStart: () => log.info('admin money-frame cron started — checks hourly'),
});

export function startAdminMoneyFrameCron(): void {
  adminMoneyFrameCronLifecycle.start();
}

export function stopAdminMoneyFrameCron(): void {
  adminMoneyFrameCronLifecycle.stop();
}
