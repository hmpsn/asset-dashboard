/**
 * public-chat routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import {
  listSessions,
  getSession as getChatSession,
  deleteSession as deleteChatSession,
  generateSessionSummary,
  checkChatRateLimit,
} from '../chat-memory.js';
import { getUsageSummary } from '../usage-tracking.js';
import { getWorkspace } from '../workspaces.js';

// --- Chat Session CRUD ---
router.get('/api/public/chat-sessions/:workspaceId', (req, res) => {
  const channel = req.query.channel as string | undefined;
  res.json(listSessions(req.params.workspaceId, channel));
});

router.get('/api/public/chat-sessions/:workspaceId/:sessionId', (req, res) => {
  const session = getChatSession(req.params.workspaceId, req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

router.delete('/api/public/chat-sessions/:workspaceId/:sessionId', (req, res) => {
  deleteChatSession(req.params.workspaceId, req.params.sessionId);
  res.json({ ok: true });
});

router.post('/api/public/chat-sessions/:workspaceId/:sessionId/summarize', async (req, res) => {
  try {
    const summary = await generateSessionSummary(req.params.workspaceId, req.params.sessionId);
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Chat usage / rate limit info
router.get('/api/public/chat-usage/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const tier = ws.tier || 'free';
  const rl = checkChatRateLimit(ws.id, tier);
  res.json({ ...rl, tier });
});

// Unified usage summary — all features for a workspace
router.get('/api/public/usage/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const tier = ws.tier || 'free';
  res.json({ tier, usage: getUsageSummary(ws.id, tier) });
});

export default router;
