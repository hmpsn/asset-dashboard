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
import { requireClientPortalAuth } from '../middleware.js';
import { computeEffectiveTier, getWorkspace } from '../workspaces.js';

// --- Chat Session CRUD ---
type ChatChannel = 'client' | 'admin' | 'search';
const CHAT_CHANNELS = new Set<ChatChannel>(['client', 'admin', 'search']);

function parseChatChannel(value: unknown): ChatChannel | undefined | null {
  // undefined means no filter was requested; null means the client sent an invalid filter.
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !CHAT_CHANNELS.has(value as ChatChannel)) return null;
  return value as ChatChannel;
}

router.use('/api/public/chat-sessions/:workspaceId', requireClientPortalAuth('workspaceId'), (req, res, next) => {
  if (!getWorkspace(req.params.workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
  next();
});

router.get('/api/public/chat-sessions/:workspaceId', (req, res) => {
  const channel = parseChatChannel(req.query.channel);
  if (channel === null) return res.status(400).json({ error: 'Invalid channel' });
  res.json(listSessions(req.params.workspaceId, channel));
});

router.get('/api/public/chat-sessions/:workspaceId/:sessionId', (req, res) => {
  const session = getChatSession(req.params.workspaceId, req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

router.delete('/api/public/chat-sessions/:workspaceId/:sessionId', (req, res) => {
  const deleted = deleteChatSession(req.params.workspaceId, req.params.sessionId);
  if (!deleted) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

router.post('/api/public/chat-sessions/:workspaceId/:sessionId/summarize', async (req, res) => {
  try {
    const session = getChatSession(req.params.workspaceId, req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
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
  const tier = computeEffectiveTier(ws);
  const rl = checkChatRateLimit(ws.id, tier);
  res.json({ ...rl, tier });
});

// Unified usage summary — all features for a workspace
router.get('/api/public/usage/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const tier = computeEffectiveTier(ws);
  res.json({ tier, usage: getUsageSummary(ws.id, tier) });
});

export default router;
