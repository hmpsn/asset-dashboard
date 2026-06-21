/**
 * The Issue (Client) P1b — Lane A A6: client-authed export + "your leads" router.
 *
 * Two client-facing reads, both behind requireAuthenticatedClientPortalAuth (server/middleware.ts) —
 * NOT requireClientPortalAuth (passwordless-URL access is wrong for PII), and NEVER requireAuth
 * (JWT-multi-user only). Both flag-gated on the-issue-client-return-hook → 404 when OFF.
 *
 *   GET /api/public/export/:workspaceId/one-pager — segment one-pager HTML (print-from-browser; there
 *       is NO PDF library — the browser prints). The client's OWN leads are embedded into the HTML on
 *       this authed surface only.
 *   GET /api/public/export/:workspaceId/my-leads   — the client's OWN captured leads (PII, JSON).
 *
 * D7: PII rides ONLY because the guard authenticated the caller. The /api/public/ path prefix is a
 * routing convention, not an auth statement — the guard is what authorizes the exposure. The export
 * DATA payload (assembleOnePagerExport) carries NO PII of its own; leads attach here via toNamedLeadView.
 */
import { Router } from 'express';
import { requireAuthenticatedClientPortalAuth } from '../middleware.js';
import { getWorkspace } from '../workspaces.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { loadFormSubmissions } from '../form-submissions.js';
import { assembleOnePagerExport, toNamedLeadView } from '../the-issue-export.js';
import { renderOnePagerHTML } from '../the-issue-one-pager-html.js';
import type { NamedLeadView } from '../../shared/types/the-issue.js';

const FLAG = 'the-issue-client-return-hook';

export const theIssueExportRouter = Router();

// GET /api/public/export/:workspaceId/one-pager — segment one-pager HTML (authed; print-from-browser).
theIssueExportRouter.get(
  '/api/public/export/:workspaceId/one-pager',
  requireAuthenticatedClientPortalAuth(),
  (req, res) => {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
    if (!isFeatureEnabled(FLAG, ws.id)) { res.sendStatus(404); return; }
    const payload = assembleOnePagerExport(ws.id);
    if (!payload) { res.status(404).json({ error: 'Export not available — verdict not yet established' }); return; }
    // Attach the client's OWN leads (authed surface only) — the export DATA payload carries none.
    const leads: NamedLeadView[] = loadFormSubmissions(ws.id).map(toNamedLeadView);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderOnePagerHTML({ ...payload, leads }));
  },
);

// GET /api/public/export/:workspaceId/my-leads — the CLIENT's OWN captured leads (authed PII, JSON).
theIssueExportRouter.get(
  '/api/public/export/:workspaceId/my-leads',
  requireAuthenticatedClientPortalAuth(),
  (req, res) => {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
    if (!isFeatureEnabled(FLAG, ws.id)) { res.sendStatus(404); return; }
    const leads: NamedLeadView[] = loadFormSubmissions(ws.id).map(toNamedLeadView);
    res.json({ leads });
  },
);
