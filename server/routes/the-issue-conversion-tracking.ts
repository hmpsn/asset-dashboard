/**
 * The Issue (Client) P1a — conversion-tracking admin setup flow (Webflow Data-API POLLING).
 *
 * Owner directive: outcome capture switched from an HMAC webhook receiver to polling the Webflow Forms
 * Data API (the signed-webhook model needed an operator-pasted per-workspace secret that didn't match
 * reality). This router is now PURE ADMIN — no public receiver. The daily poller lives in
 * server/webflow-form-poller.ts; the storage/provenance/client render are source-agnostic and unchanged.
 *
 * Endpoints (all requireWorkspaceAccess — NEVER requireAuth; admin auth is the HMAC x-auth-token gate;
 * all flag-gated → 404 when the-issue-client-measured-capture is OFF):
 *   GET  /api/workspaces/:id/conversion-tracking-status  — verification readout (counts + freshness)
 *   GET  /api/workspaces/:id/webflow-forms               — list the site's forms for the picker
 *   PUT  /api/workspaces/:id/form-sources                — save formId→outcomeType mappings; confirm setup
 *
 * D7: captured lead identity (leadName/leadEmail/leadMessage) is admin-internal and NEVER serialized
 * into any payload here — the status readout exposes counts + freshness only.
 */
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { getWorkspace, getTokenForSite, updateWorkspace } from '../workspaces.js';
import { listWebflowForms } from '../webflow-forms.js';
import { getFormCaptureStatus } from '../form-submissions.js';
import { loadGa4SnapshotHistory } from '../ga4-snapshots.js';
import { aggregatePinnedOutcomes } from '../the-issue-outcome.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { addActivity } from '../activity-log.js';
import { validate, z } from '../middleware/validate.js';
import { webflowFormMappingSchema } from '../schemas/workspace-schemas.js';
import type { WebflowFormMapping } from '../../shared/types/form-submission.js';
import { createLogger } from '../logger.js';

const log = createLogger('the-issue-conversion-tracking');

const FLAG = 'the-issue-client-measured-capture';

export const theIssueConversionTrackingRouter = Router();

// ── Admin: verification readout ──────────────────────────────────────────────
// GET /api/workspaces/:id/conversion-tracking-status
theIssueConversionTrackingRouter.get(
  '/api/workspaces/:id/conversion-tracking-status',
  requireWorkspaceAccess(),
  (req, res) => {
    const ws = getWorkspace(req.params.id);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (!isFeatureEnabled(FLAG, ws.id)) {
      res.sendStatus(404);
      return;
    }
    const pinned = (ws.eventConfig ?? []).filter((c) => c.pinned);
    const status = getFormCaptureStatus(ws.id);
    // Count-only basis for the admin value-integrity preview ("last period would have read ~$Y").
    // The latest GA4 snapshot's pinned-outcome total — anonymous aggregate, never PII.
    const history = loadGa4SnapshotHistory(ws.id);
    const latest = history.length > 0 ? history[history.length - 1] : null;
    const recentOutcomeCount = latest ? aggregatePinnedOutcomes(ws, latest.byEvent).totalConversions : 0;
    res.json({
      pinnedCount: pinned.length,
      typedCount: pinned.filter((c) => c.outcomeType).length,
      // Provenance-flip basis (D6): confirmed setup AND ≥1 tracked Webflow form selected.
      formCaptureConnected: !!ws.conversionTrackingConfirmedAt && (ws.webflowFormSources?.length ?? 0) > 0,
      lastSubmissionAt: status.lastSubmissionAt,
      submissionCount: status.count,
      recentOutcomeCount,
    });
  },
);

// ── Admin: list the site's Webflow forms (for the "select forms to track" picker) ──
// GET /api/workspaces/:id/webflow-forms
theIssueConversionTrackingRouter.get(
  '/api/workspaces/:id/webflow-forms',
  requireWorkspaceAccess(),
  async (req, res) => {
    const ws = getWorkspace(req.params.id);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (!isFeatureEnabled(FLAG, ws.id)) {
      res.sendStatus(404);
      return;
    }
    if (!ws.webflowSiteId) {
      res.status(400).json({ error: 'Link a Webflow site first' });
      return;
    }
    try {
      const token = getTokenForSite(ws.webflowSiteId) || undefined;
      const forms = await listWebflowForms(ws.webflowSiteId, token);
      res.json({ forms });
    } catch (err) {
      // FM-2 honest degradation: a Webflow API error returns an empty picker + error, never a 500 throw.
      log.warn({ err, workspaceId: ws.id }, 'Failed to list Webflow forms');
      res.status(502).json({ error: 'Could not load Webflow forms', forms: [] });
    }
  },
);

// ── Admin: save the form-source mappings (+ confirm setup when ≥1 mapped) ─────
// PUT /api/workspaces/:id/form-sources
const formSourcesBodySchema = z.object({
  sources: z.array(webflowFormMappingSchema),
});

theIssueConversionTrackingRouter.put(
  '/api/workspaces/:id/form-sources',
  requireWorkspaceAccess(),
  validate(formSourcesBodySchema),
  (req, res) => {
    const ws = getWorkspace(req.params.id);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (!isFeatureEnabled(FLAG, ws.id)) {
      res.sendStatus(404);
      return;
    }
    // The zod enum on outcomeType matches OutcomeType exactly, so the validated body is WebflowFormMapping[].
    const sources = req.body.sources as WebflowFormMapping[];
    // Confirm setup (the D6 provenance-flip basis) when ≥1 form is mapped; preserve an existing
    // confirmation timestamp (a re-save shouldn't reset it). Clearing all sources leaves the prior
    // confirmation intact — a captured lead history already justifies "measured".
    const alreadyConfirmed = !!ws.conversionTrackingConfirmedAt;
    const confirm = sources.length > 0 && !alreadyConfirmed
      ? { conversionTrackingConfirmedAt: new Date().toISOString() }
      : {};
    updateWorkspace(ws.id, { webflowFormSources: sources, ...confirm });
    // Audit trail for a config mutation that can flip the D6 provenance marker (admin-only; the type is
    // NOT in CLIENT_VISIBLE_TYPES). PII-free metadata — only the count of mapped forms (D7).
    addActivity(ws.id, 'form_capture_configured', `Tracked Webflow forms updated (${sources.length} mapped)`, undefined, {
      formCount: sources.length,
    });
    res.json({
      saved: true,
      // Connected once ≥1 form is mapped — saving sources confirms setup in this same call (above),
      // so the provenance-flip basis (confirmed AND ≥1 form) reduces to "≥1 form mapped".
      formCaptureConnected: sources.length > 0,
    });
  },
);
