// server/outcome-coverage.ts
// Reconcile R9 (Task B15) — ADMIN-ONLY outcome coverage funnel.
//
// Scope note: R9 was cut down by the Readiness Atlas audit to ONLY this narrow slice — an
// admin-only metric showing how outcomes progress tracked → measured → reconciled, backed by
// the `provenance` column on `action_outcomes` (migration 169). This module does NOT touch any
// client-facing surface or dollar figure; see the HARD STOP contract in the task ticket and the
// `grep -rn "provenance" src/components/client/` verification.
//
// `provenance` is DISTINCT from the existing client-facing `OutcomeProvenance` shared type — see
// the OutcomeCoverageProvenance doc comment in shared/types/outcome-tracking.ts for the split
// rationale. Do not conflate the two when reading this file.

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type { OutcomeCoverage } from '../shared/types/outcome-tracking.js';

const stmts = createStmtCache(() => ({
  // ws-scope-ok: action_outcomes has no workspace_id column; scoping happens via the
  // tracked_actions join, matching every other workspace-scoped action_outcomes query in
  // server/outcome-tracking.ts (getOverviewStats, getWinsWithValueByWorkspace, etc.).
  //
  // COALESCE(ao.provenance, 'estimate_ga4') applies the NULL → estimate_ga4 read-fallback
  // BEFORE bucketing, so a legacy row is counted exactly once, in the tracked-only bucket —
  // it can never double-count into measured/reconciled by accident.
  coverageByWorkspace: db.prepare(`
    SELECT
      COUNT(*) AS tracked,
      COALESCE(SUM(CASE
        WHEN COALESCE(ao.provenance, 'estimate_ga4') IN ('measured_action', 'actual_reconciled')
        THEN 1 ELSE 0 END), 0) AS measured,
      COALESCE(SUM(CASE
        WHEN COALESCE(ao.provenance, 'estimate_ga4') = 'actual_reconciled'
        THEN 1 ELSE 0 END), 0) AS reconciled
    FROM action_outcomes ao
    JOIN tracked_actions ta ON ta.id = ao.action_id
    WHERE ta.workspace_id = ?
  `),
}));

/**
 * Computes the outcome coverage funnel for a workspace. Read-only; safe to call on any admin
 * request path. Returns all-zero counts for a workspace with no outcome rows (never throws for
 * an empty/unknown workspace — matches the zero-row convention of getWorkspaceCounts /
 * getOverviewStats in server/outcome-tracking.ts).
 */
export function computeOutcomeCoverage(workspaceId: string): OutcomeCoverage {
  const row = stmts().coverageByWorkspace.get(workspaceId) as
    | { tracked: number; measured: number; reconciled: number }
    | undefined;
  return row ?? { tracked: 0, measured: 0, reconciled: 0 };
}
