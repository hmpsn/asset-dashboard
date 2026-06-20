/**
 * The Issue (Client) P1a — conversion-tracking setup flow + Webflow form-webhook receiver.
 *
 * Two surfaces, one bounded context (outcomes-roi):
 *
 *  1. PUBLIC webhook receiver — `handleWebflowFormWebhook` (mounted in app.ts via express.raw BEFORE
 *     express.json, sibling to the Stripe webhook). HMAC-verified (Lane A's verifyWebflowSignature),
 *     idempotent (saveFormSubmission), flag-gated (404 when OFF — the A9 receiver-inert case). On a
 *     NEW capture it broadcasts FORM_SUBMISSION_CAPTURED + logs the admin-only form_submission_captured
 *     activity (PII omitted from metadata, D7) and confirms setup on the first lead (D6 provenance flip).
 *
 *  2. ADMIN endpoints (requireWorkspaceAccess — NEVER requireAuth; admin auth is the HMAC x-auth-token
 *     gate): GET status (verification readout), POST enable (mint + return the signing secret ONCE),
 *     POST disable (clear secret + sources). All flag-gated.
 *
 * D7: the signing secret + captured lead identity (leadName/leadEmail/leadMessage) are admin-internal
 * and NEVER serialized into any public/client payload. The secret is returned exactly once on enable.
 */
import express, { Router } from 'express';
import crypto from 'node:crypto';
import { requireWorkspaceAccess } from '../auth.js';
import { getWorkspace, updateWorkspace } from '../workspaces.js';
import { verifyWebflowSignature, parseWebflowFormPayload, resolveOutcomeType } from '../webflow-form-webhook.js';
import { saveFormSubmission, getFormCaptureStatus } from '../form-submissions.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { loadGa4SnapshotHistory } from '../ga4-snapshots.js';
import { aggregatePinnedOutcomes } from '../the-issue-outcome.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { addActivity } from '../activity-log.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { createLogger } from '../logger.js';

const log = createLogger('the-issue-conversion-tracking');

const FLAG = 'the-issue-client-measured-capture';

export const theIssueConversionTrackingRouter = Router();

/**
 * PUBLIC: Webflow form-submission webhook receiver. Mounted with express.raw in app.ts so `req.body`
 * is a Buffer (the HMAC must verify the EXACT bytes Webflow signed). Returns 404 when the flag is OFF
 * (the receiver is inert — A9). Never throws to the client: malformed body → 400, bad signature → 401.
 */
export function handleWebflowFormWebhook(req: express.Request, res: express.Response): void {
  const ws = getWorkspace(req.params.workspaceId);
  // Inert (404) when the workspace is unknown OR the flag is OFF — no oracle, no capture.
  if (!ws || !isFeatureEnabled(FLAG, ws.id)) {
    res.sendStatus(404);
    return;
  }
  const secret = ws.webflowFormWebhookSecret;
  if (!secret) {
    res.status(400).json({ error: 'Webflow form webhook not configured' });
    return;
  }

  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  // Webflow signs `${timestamp}:${rawBody}` and sends the signed timestamp in X-Webflow-Timestamp.
  // Reject a missing / non-numeric / stale timestamp (>5min skew) before the HMAC check to bound replay.
  const ts = req.header('x-webflow-timestamp');
  if (!ts || Number.isNaN(Number(ts)) || Math.abs(Date.now() - Number(ts)) > 300_000) {
    log.warn({ workspaceId: ws.id }, 'webflow form webhook: missing or stale timestamp');
    res.sendStatus(401);
    return;
  }
  const signature = req.header('x-webflow-signature') ?? '';
  if (!verifyWebflowSignature(raw, signature, secret, ts)) {
    log.warn({ workspaceId: ws.id }, 'webflow form webhook: invalid signature');
    res.sendStatus(401);
    return;
  }

  // parseJsonFallback never throws: a non-empty-but-malformed body yields undefined → 400. Valid JSON
  // (object or not) is handed to parseWebflowFormPayload, which returns null on a non-form trigger.
  const json = parseJsonFallback<unknown>(raw, undefined);
  if (json === undefined && raw.trim().length > 0) {
    res.sendStatus(400);
    return;
  }
  const parsed = parseWebflowFormPayload(json);
  // A non-form trigger (site_publish, etc.) is acknowledged but stores nothing.
  if (!parsed) {
    res.status(200).json({ ignored: true });
    return;
  }

  const outcomeType = resolveOutcomeType(ws, parsed.formId, parsed.formName);
  const { inserted } = saveFormSubmission({
    workspaceId: ws.id,
    formId: parsed.formId,
    submissionId: parsed.submissionId,
    formName: parsed.formName,
    leadName: parsed.leadName,
    leadEmail: parsed.leadEmail,
    leadMessage: parsed.leadMessage,
    eventName: 'form_submit',
    outcomeType,
    submittedAt: parsed.submittedAt,
    capturedAt: new Date().toISOString(),
  });

  if (inserted) {
    // D6 provenance-flip basis: the first captured real lead confirms setup if the operator hasn't yet.
    if (!ws.conversionTrackingConfirmedAt) {
      updateWorkspace(ws.id, { conversionTrackingConfirmedAt: new Date().toISOString() });
    }
    // PII omitted from metadata (D7) — only the form id + resolved outcome type.
    addActivity(ws.id, 'form_submission_captured', `New ${parsed.formName} submission captured`, undefined, {
      formId: parsed.formId,
      outcomeType,
    });
    broadcastToWorkspace(ws.id, WS_EVENTS.FORM_SUBMISSION_CAPTURED, { workspaceId: ws.id, outcomeType });
  }

  res.status(200).json({ ok: true, inserted });
}

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
      // The provenance-flip basis (D6): confirmed setup AND a signing secret exists.
      formCaptureConnected: !!ws.conversionTrackingConfirmedAt && !!ws.webflowFormWebhookSecret,
      lastSubmissionAt: status.lastSubmissionAt,
      submissionCount: status.count,
      recentOutcomeCount,
    });
  },
);

// ── Admin: enable form capture (mint + return the signing secret ONCE) ───────
// POST /api/workspaces/:id/form-capture/enable
theIssueConversionTrackingRouter.post(
  '/api/workspaces/:id/form-capture/enable',
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
    // Mint a fresh secret on first enable; preserve an existing one so re-enable is idempotent and the
    // operator's already-pasted Webflow secret keeps working. (Rotation = disable then enable.)
    const secret = ws.webflowFormWebhookSecret ?? crypto.randomBytes(24).toString('hex');
    if (!ws.webflowFormWebhookSecret) {
      updateWorkspace(ws.id, { webflowFormWebhookSecret: secret });
    }
    const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
    res.json({
      webhookUrl: `${origin}/api/public/webflow-form-webhook/${ws.id}`,
      // Shown exactly once — never re-serialized (the GET status endpoint never returns it). D7.
      webhookSecret: secret,
    });
  },
);

// ── Admin: disable form capture (clear secret + sources) ─────────────────────
// POST /api/workspaces/:id/form-capture/disable
theIssueConversionTrackingRouter.post(
  '/api/workspaces/:id/form-capture/disable',
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
    updateWorkspace(ws.id, { webflowFormWebhookSecret: undefined, webflowFormSources: [] });
    res.json({ disabled: true });
  },
);
