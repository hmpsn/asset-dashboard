/**
 * Client signals routes — admin CRUD + public signal creation endpoint.
 *
 * Auth convention:
 *   - Admin routes: protected by global APP_PASSWORD gate (no requireAuth needed)
 *   - Public route: no auth (accessible from client portal)
 *
 * Never add requireAuth to admin routes — see CLAUDE.md Auth Conventions.
 */
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import {
  listClientSignals,
  getSignalById,
  updateSignalStatus,
  createClientSignal,
} from '../client-signals-store.js';
import { getWorkspace } from '../workspaces.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { notifyTeamClientSignal } from '../email.js';
import { addActivity } from '../activity-log.js';
import { createLogger } from '../logger.js';

const log = createLogger('client-signals-routes');
const router = Router();

// ── Admin: get single signal (literal sub-path registered BEFORE /:workspaceId) ─

router.get('/api/client-signals/detail/:id', (req, res) => {
  const signal = getSignalById(req.params.id);
  if (!signal) return res.status(404).json({ error: 'Signal not found' });
  res.json(signal);
});

// ── Admin: list signals for a workspace ──────────────────────────────────────

router.get(
  '/api/client-signals/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const signals = listClientSignals(req.params.workspaceId);
    res.json(signals);
  },
);

// ── Admin: update signal status ───────────────────────────────────────────────

const updateStatusSchema = z.object({
  status: z.enum(['new', 'reviewed', 'actioned']),
});

router.patch(
  '/api/client-signals/:id/status',
  validate(updateStatusSchema),
  (req, res) => {
    const { status } = req.body as z.infer<typeof updateStatusSchema>;
    const signal = getSignalById(req.params.id);
    if (!signal) return res.status(404).json({ error: 'Signal not found' });
    const ok = updateSignalStatus(req.params.id, status);
    if (!ok) return res.status(500).json({ error: 'Update failed' });
    const updated = getSignalById(req.params.id);
    broadcastToWorkspace(signal.workspaceId, WS_EVENTS.CLIENT_SIGNAL_UPDATED, { signalId: req.params.id });
    res.json(updated);
  },
);

// ── Public: create signal from client portal ─────────────────────────────────

const createSignalSchema = z.object({
  type: z.enum(['content_interest', 'service_interest']),
  triggerMessage: z.string().max(500),
  chatContext: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(5000),
    }),
  ).max(10),
});

router.post(
  '/api/public/signal/:workspaceId',
  validate(createSignalSchema),
  async (req, res) => {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(400).json({ error: 'Workspace not configured' });

    const { type, triggerMessage, chatContext } = req.body as z.infer<typeof createSignalSchema>;

    try {
      const signal = createClientSignal({
        workspaceId: ws.id,
        workspaceName: ws.name,
        type,
        chatContext,
        triggerMessage,
      });

      broadcastToWorkspace(ws.id, WS_EVENTS.CLIENT_SIGNAL_CREATED, { signalId: signal.id });
      addActivity(ws.id, 'client_signal', `Client signal: ${type}`, triggerMessage.slice(0, 80));

      notifyTeamClientSignal(ws.id, ws.name, type, triggerMessage);

      res.json({ ok: true, signalId: signal.id });
    } catch (err) {
      log.error({ err }, 'Failed to create client signal');
      res.status(500).json({ error: 'Failed to create signal' });
    }
  },
);

export default router;
