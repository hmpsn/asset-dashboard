import type { Response } from 'express';
import { assertCreditBudget, CreditBudgetError } from './credit-budget-gate.js';
import { isFeatureEnabled } from './feature-flags.js';
import { createJob, hasActiveJob, registerAbort, updateJob } from './jobs.js';
import { computeEffectiveTier, getWorkspace } from './workspaces.js';
import type { BackgroundJobType } from '../shared/types/background-jobs.js';
import type { FeatureFlagKey } from '../shared/types/feature-flags.js';
import type { UsageTier } from '../shared/types/usage.js';

interface RefreshRuntimeLogger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

interface RefreshFeatureGate {
  flag: FeatureFlagKey;
  disabledError: string;
}

interface RefreshTierGate {
  forbiddenError: string;
}

interface RefreshBudgetGate {
  endpoint: string;
  wouldBlockLogMessage: string;
}

interface RefreshPlan {
  total?: number;
  response?: Record<string, unknown>;
}

export interface StartTrackedRefreshOptions {
  workspaceId: string;
  res: Response;
  logger: RefreshRuntimeLogger;
  jobType: BackgroundJobType;
  preparingMessage: string;
  workspaceConflictError: string;
  globalConflictError: string;
  unexpectedFailureLogMessage: string;
  unexpectedFailureMessage: string;
  featureGate?: RefreshFeatureGate;
  tierGate?: RefreshTierGate;
  budgetGate?: RefreshBudgetGate;
  prepare?: () => RefreshPlan | null;
  run: (jobId: string) => Promise<void>;
}

function isGrowthOrPremium(tier: UsageTier): boolean {
  return tier === 'growth' || tier === 'premium';
}

export function startTrackedRefresh({
  workspaceId,
  res,
  logger,
  jobType,
  preparingMessage,
  workspaceConflictError,
  globalConflictError,
  unexpectedFailureLogMessage,
  unexpectedFailureMessage,
  featureGate,
  tierGate,
  budgetGate,
  prepare,
  run,
}: StartTrackedRefreshOptions): void {
  if (featureGate && !isFeatureEnabled(featureGate.flag, workspaceId)) {
    res.status(404).json({ error: featureGate.disabledError });
    return;
  }

  let tier: UsageTier | undefined;
  if (tierGate || budgetGate) {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    tier = computeEffectiveTier(workspace);
    if (tierGate && !isGrowthOrPremium(tier)) {
      res.status(403).json({ error: tierGate.forbiddenError });
      return;
    }
  }

  if (budgetGate) {
    try {
      assertCreditBudget(workspaceId, budgetGate.endpoint, tier);
    } catch (err) {
      if (err instanceof CreditBudgetError) {
        logger.warn({ workspaceId, tier }, budgetGate.wouldBlockLogMessage);
      } else {
        throw err;
      }
    }
  }

  const active = hasActiveJob(jobType, workspaceId);
  if (active) {
    res.status(409).json({ error: workspaceConflictError, jobId: active.id });
    return;
  }

  const globalActive = hasActiveJob(jobType);
  if (globalActive) {
    res.status(409).json({
      error: globalConflictError,
      jobId: globalActive.id,
      blockingWorkspaceId: globalActive.workspaceId,
    });
    return;
  }

  const plan = prepare?.();
  if (plan === null) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  const job = createJob(jobType, {
    workspaceId,
    total: plan?.total,
    message: preparingMessage,
  });
  registerAbort(job.id);
  res.json({ jobId: job.id, ...(plan?.response ?? {}) });

  run(job.id).catch(err => {
    logger.error({ err, jobId: job.id, workspaceId }, unexpectedFailureLogMessage);
    updateJob(job.id, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: unexpectedFailureMessage,
    });
  });
}
