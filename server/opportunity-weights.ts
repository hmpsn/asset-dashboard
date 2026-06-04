/**
 * opportunity-weights — per-workspace calibrated Opportunity Value display weights
 * (PR5 · Spine C).
 *
 * The 7 dimension weights feed the OV component-breakdown DISPLAY only (never the
 * scored value — see computeOpportunityValue). Default = platform DEFAULT_WEIGHTS,
 * so day-one behavior is unchanged. The monthly ridge-nudge auto-tuning toward the
 * Predictive weighting mix is OUT OF SCOPE for PR5 (deferred): this module ships the
 * table + getOrCreate at platform defaults so the weights round-trip and the
 * scorer reads a per-workspace OpportunityWeights instead of the module const.
 *
 * Lockstep (CLAUDE.md DB column + mapper): migration 109 + row interface +
 * rowToOpportunityWeights + getOrCreate + upsert + Zod schema, all here.
 */
import { z } from 'zod';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { DEFAULT_WEIGHTS } from './scoring/opportunity-value.js';
import type { OpportunityWeights } from '../shared/types/recommendations.js';

interface WorkspaceOpportunityWeightsRow {
  workspace_id: string;
  demand: number;
  winnability: number;
  intent: number;
  effort: number;
  business_fit: number;
  timing: number;
  evidence: number;
  calibration_version: string;
  updated_at: string;
}

/** Zod schema mirroring OpportunityWeights (validation parity per CLAUDE.md). */
export const opportunityWeightsSchema = z.object({
  demand: z.number(),
  winnability: z.number(),
  intent: z.number(),
  effort: z.number(),
  businessFit: z.number(),
  timing: z.number(),
  evidence: z.number(),
  calibrationVersion: z.string(),
});

function rowToOpportunityWeights(r: WorkspaceOpportunityWeightsRow): OpportunityWeights {
  return {
    demand: r.demand,
    winnability: r.winnability,
    intent: r.intent,
    effort: r.effort,
    businessFit: r.business_fit,
    timing: r.timing,
    evidence: r.evidence,
    calibrationVersion: r.calibration_version,
  };
}

const stmts = createStmtCache(() => ({
  get: db.prepare<[workspaceId: string]>('SELECT * FROM workspace_opportunity_weights WHERE workspace_id = ?'),
  upsert: db.prepare(`
    INSERT INTO workspace_opportunity_weights (
      workspace_id, demand, winnability, intent, effort, business_fit, timing, evidence, calibration_version, updated_at
    ) VALUES (
      @workspace_id, @demand, @winnability, @intent, @effort, @business_fit, @timing, @evidence, @calibration_version, @updated_at
    )
    ON CONFLICT(workspace_id) DO UPDATE SET
      demand = excluded.demand,
      winnability = excluded.winnability,
      intent = excluded.intent,
      effort = excluded.effort,
      business_fit = excluded.business_fit,
      timing = excluded.timing,
      evidence = excluded.evidence,
      calibration_version = excluded.calibration_version,
      updated_at = excluded.updated_at
  `),
}));

/** Persist (insert-or-update) the calibrated display weights for a workspace. */
export function upsertWorkspaceWeights(workspaceId: string, weights: OpportunityWeights): OpportunityWeights {
  stmts().upsert.run({
    workspace_id: workspaceId,
    demand: weights.demand,
    winnability: weights.winnability,
    intent: weights.intent,
    effort: weights.effort,
    business_fit: weights.businessFit,
    timing: weights.timing,
    evidence: weights.evidence,
    calibration_version: weights.calibrationVersion,
    updated_at: new Date().toISOString(),
  });
  return weights;
}

/**
 * Always returns an OpportunityWeights (never null). Reads the persisted
 * per-workspace weights when present; otherwise materializes a row at the
 * platform DEFAULT_WEIGHTS and returns it. Non-nullable per the pr-check
 * getOrCreate rule. Until the (deferred) monthly ridge-nudge runs, every
 * workspace resolves to DEFAULT_WEIGHTS — so behavior is unchanged day-one.
 */
export function getOrCreateWorkspaceWeights(workspaceId: string): OpportunityWeights {
  const existing = stmts().get.get(workspaceId) as WorkspaceOpportunityWeightsRow | undefined;
  if (existing) return rowToOpportunityWeights(existing);
  return upsertWorkspaceWeights(workspaceId, { ...DEFAULT_WEIGHTS });
}
