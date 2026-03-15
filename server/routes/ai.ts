/**
 * ai routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { addActivity } from '../activity-log.js';
import {
  addMessage,
  buildConversationContext,
  getSession as getChatSession,
  generateSessionSummary,
} from '../chat-memory.js';
import {
  callOpenAI,
  getTokenUsage,
  getTimeSaved,
  getUsageByDay,
  getUsageByFeature,
} from '../openai-helpers.js';
import { getSemrushUsage, getSemrushByDay } from '../semrush.js';
import { getWorkspace } from '../workspaces.js';
import { checkAIContext } from '../ai-context-check.js';
import { aiLimiter } from '../middleware.js';
import { assembleAdminContext, buildSystemPrompt } from '../admin-chat-context.js';

// ── Admin AI Chat (auth-gated, internal analyst persona) ──
// Context is now assembled server-side based on the question —
// the frontend only needs to send { workspaceId, question, sessionId }.
router.post('/api/admin-chat', aiLimiter, async (req, res) => {
  const { workspaceId, question, sessionId, days } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(400).json({ error: 'Workspace not found' });
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(400).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    // Build conversation context from memory
    let historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let priorContext = '';
    if (sessionId) {
      const ctx = buildConversationContext(ws.id, sessionId, 'admin');
      historyMessages = ctx.historyMessages;
      priorContext = ctx.priorContext;
      addMessage(ws.id, sessionId, 'admin', 'user', question);
    }

    // Assemble context server-side — question-aware, pulls only relevant data
    const dataDays = typeof days === 'number' ? days : 28;
    const assembled = await assembleAdminContext(workspaceId, question, dataDays);

    // Build the system prompt based on the assembled context and chat mode
    const systemPrompt = buildSystemPrompt(ws, assembled, dataDays, priorContext);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...historyMessages.slice(-10),
      { role: 'user', content: question },
    ];

    // Content review and page analysis may need more tokens for detailed feedback
    const maxTokens = assembled.mode === 'analyst' ? 2000 : 3000;

    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages,
      temperature: 0.6,
      maxTokens,
      feature: 'admin-chat',
      workspaceId: ws.id,
    });

    const answer = aiResult.text || 'No response generated.';

    // Persist assistant response + auto-summarize
    if (sessionId) {
      addMessage(ws.id, sessionId, 'admin', 'assistant', answer);
      const session = getChatSession(ws.id, sessionId);
      // Log first admin chat exchange to activity
      if (session && session.messages.length === 2) {
        addActivity(ws.id, 'chat_session', 'Admin chat: ' + question.trim().slice(0, 80), `Admin started a new Insights conversation`);
      }
      if (session && session.messages.length >= 6 && !session.summary) {
        generateSessionSummary(ws.id, sessionId).catch(() => {});
      }
    }

    res.json({
      answer,
      sessionId: sessionId || undefined,
      mode: assembled.mode,
      dataSourceCount: assembled.dataSources.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// --- AI Context Completeness ---
router.get('/api/ai/context/:workspaceId', (req, res) => {
  res.json(checkAIContext(req.params.workspaceId));
});

// --- AI Token Usage Tracking ---
router.get('/api/ai/usage', (req, res) => {
  const workspaceId = req.query.workspaceId as string | undefined;
  const since = req.query.since as string | undefined;
  const days = parseInt(req.query.days as string || '30', 10);
  const summary = getTokenUsage(workspaceId, since);
  const daily = getUsageByDay(workspaceId, days);
  const byFeature = getUsageByFeature(workspaceId, since);
  const semrush = getSemrushUsage(workspaceId, since);
  const semrushDaily = getSemrushByDay(workspaceId, days);
  res.json({ ...summary, daily, byFeature, semrush, semrushDaily });
});

// --- Time Saved Metric ---
router.get('/api/ai/time-saved', (req, res) => {
  const workspaceId = req.query.workspaceId as string | undefined;
  const since = req.query.since as string | undefined;
  res.json(getTimeSaved(workspaceId, since));
});

export default router;
