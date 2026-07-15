/**
 * The Issue (Client) P0 — admin-side advisory endpoint(s).
 *
 * P0 ships exactly ONE endpoint here: the outcome-value AI-enrich proposer. It returns a
 * low-confidence { valuePerOutcome, unitLabel } estimate and NEVER persists it — the admin's
 * confirm is the standard PATCH /api/workspaces/:id carrying outcomeValue with basis: 'ai_enriched'.
 *
 * The non-local segment-derivation AI op + endpoint were a planned P1 feature that was never
 * built; its reserved flag (the-issue-client-segment-inserts) was retired as a phantom in
 * flag-sunset Wave 1. The P0 segment UI is a manual FormSelect.
 *
 * Auth: requireWorkspaceAccess (NOT requireAuth) per Auth Conventions — the admin panel
 * authenticates via the HMAC token validated by the global APP_PASSWORD gate.
 */
import express from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { getWorkspace } from '../workspaces.js';
import { enrichLeadValue } from '../the-issue-lead-value-ai.js';
import { createLogger } from '../logger.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { loadAdminMoneyFrame } from '../money-frame-store.js';

const log = createLogger('the-issue-admin');

export const theIssueAdminRouter = express.Router();

// GET /api/workspaces/:id/admin-money-frame
// Read-safe UI-rebuild projection. The cron owns computeROI(); this route only returns the
// persisted AdminMoneyFrame or an honest 404 when the frame has not been precomputed yet.
theIssueAdminRouter.get(
  '/api/workspaces/:id/admin-money-frame',
  requireWorkspaceAccess(),
  (req, res) => {
    const ws = getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (!isFeatureEnabled('ui-rebuild-shell', ws.id)) {
      res.sendStatus(404);
      return;
    }
    const frame = loadAdminMoneyFrame(ws.id);
    if (!frame) {
      res.status(404).json({ error: 'Admin money frame has not been precomputed' });
      return;
    }
    res.json(frame);
  },
);

// Read-only proposer — never persists. On AI failure returns 502 (FM-2 honest degradation) so
// nothing fabricated reaches the workspace; the admin retries or sets the value manually.
theIssueAdminRouter.post(
  '/api/workspaces/:id/outcome-value-enrich',
  requireWorkspaceAccess(),
  async (req, res) => {
    const ws = getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    try {
      const v = await enrichLeadValue({
        workspaceId: ws.id,
        industry: ws.intelligenceProfile?.industry,
        currency: ws.outcomeValue?.currency ?? 'USD',
      });
      if (!v) return res.status(502).json({ error: 'Outcome-value estimate failed' });
      return res.json({ valuePerOutcome: v.valuePerOutcome, unitLabel: v.unitLabel });
    } catch (err) {
      log.warn({ err, workspaceId: ws.id }, 'outcome-value-enrich: estimate failed');
      return res.status(502).json({ error: 'Outcome-value estimate failed' });
    }
  },
);
