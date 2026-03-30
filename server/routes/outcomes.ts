/**
 * outcomes routes — Outcome Intelligence Engine REST API
 */
import { Router } from 'express';
import { requireAuth, requireWorkspaceAccess } from '../auth.js';
import { requireClientPortalAuth } from '../middleware.js';
import { validate, z } from '../middleware/validate.js';
import { isFeatureEnabled } from '../feature-flags.js';
import { createLogger } from '../logger.js';
import { listWorkspaces } from '../workspaces.js';
import {
  getAction,
  getActionsByWorkspace,
  getActionsByWorkspaceAndType,
  getOutcomesForAction,
  getRecentActions,
  getWorkspaceCounts,
  updateActionContext,
} from '../outcome-tracking.js';
import { getPlaybooks } from '../outcome-playbooks.js';
import { getWorkspaceLearnings } from '../workspace-learnings.js';
import type {
  ActionType,
  ActionPlaybook,
  OutcomeScorecard,
  TopWin,
  WorkspaceOutcomeOverview,
  WeCalledItEntry,
  LearningsTrend,
  TrackedAction,
  ActionOutcome,
  OutcomeScore,
} from '../../shared/types/outcome-tracking.js';

const log = createLogger('outcomes');

const router = Router();

// ── Feature flag guard ──
router.use('/api/outcomes', (_req, res, next) => {
  if (!isFeatureEnabled('outcome-tracking')) return res.status(404).json({ error: 'Not found' });
  next();
});
router.use('/api/public/outcomes', (_req, res, next) => {
  if (!isFeatureEnabled('outcome-tracking')) return res.status(404).json({ error: 'Not found' });
  next();
});

// ── Helpers ──

const WIN_SCORES: OutcomeScore[] = ['strong_win', 'win'];

function computeScorecard(workspaceId: string): OutcomeScorecard {
  const actions = getActionsByWorkspace(workspaceId);

  // Group by action type
  const byType = new Map<ActionType, { wins: number; strongWins: number; scored: number; total: number }>();
  let totalWins = 0;
  let totalStrongWins = 0;
  let totalScored = 0;
  let pendingCount = 0;

  for (const action of actions) {
    const outcomes = getOutcomesForAction(action.id);
    const latestScored = outcomes.filter(o => o.score && o.score !== 'insufficient_data' && o.score !== 'inconclusive');
    const latestOutcome = latestScored.length > 0 ? latestScored[latestScored.length - 1] : null;

    if (!action.measurementComplete) pendingCount++;

    const entry = byType.get(action.actionType) ?? { wins: 0, strongWins: 0, scored: 0, total: 0 };
    entry.total++;

    if (latestOutcome) {
      entry.scored++;
      totalScored++;
      if (latestOutcome.score === 'strong_win') {
        entry.strongWins++;
        entry.wins++;
        totalStrongWins++;
        totalWins++;
      } else if (latestOutcome.score === 'win') {
        entry.wins++;
        totalWins++;
      }
    }

    byType.set(action.actionType, entry);
  }

  const byCategory = Array.from(byType.entries()).map(([actionType, data]) => ({
    actionType,
    winRate: data.scored > 0 ? data.wins / data.scored : 0,
    count: data.total,
    scored: data.scored,
  }));

  // Determine trend from recent vs older win rate
  const recentActions = actions.slice(0, Math.ceil(actions.length / 2));
  let recentWins = 0;
  let recentScored = 0;
  for (const a of recentActions) {
    const outcomes = getOutcomesForAction(a.id);
    const scored = outcomes.filter(o => o.score && o.score !== 'insufficient_data' && o.score !== 'inconclusive');
    if (scored.length > 0) {
      recentScored++;
      const latest = scored[scored.length - 1];
      if (WIN_SCORES.includes(latest.score!)) recentWins++;
    }
  }
  const recentWinRate = recentScored > 0 ? recentWins / recentScored : 0;
  const overallWinRate = totalScored > 0 ? totalWins / totalScored : 0;
  let trend: LearningsTrend = 'stable';
  if (recentScored >= 3) {
    if (recentWinRate > overallWinRate + 0.1) trend = 'improving';
    else if (recentWinRate < overallWinRate - 0.1) trend = 'declining';
  }

  return {
    overallWinRate,
    strongWinRate: totalScored > 0 ? totalStrongWins / totalScored : 0,
    totalTracked: actions.length,
    totalScored,
    pendingMeasurement: pendingCount,
    byCategory,
    trend,
  };
}

function getTopWinsForWorkspace(workspaceId: string, limit = 10): TopWin[] {
  const actions = getActionsByWorkspace(workspaceId);
  const wins: TopWin[] = [];

  for (const action of actions) {
    const outcomes = getOutcomesForAction(action.id);
    for (const outcome of outcomes) {
      if (outcome.score && WIN_SCORES.includes(outcome.score)) {
        wins.push({
          actionId: action.id,
          actionType: action.actionType,
          pageUrl: action.pageUrl,
          targetKeyword: action.targetKeyword,
          delta: outcome.deltaSummary,
          score: outcome.score,
          createdAt: action.createdAt,
          scoredAt: outcome.measuredAt,
        });
      }
    }
  }

  // Sort by absolute delta (highest impact first)
  wins.sort((a, b) => Math.abs(b.delta.delta_percent) - Math.abs(a.delta.delta_percent));
  return wins.slice(0, limit);
}

// ══════════════════════════════════════════════════════
// ADMIN ROUTES (requireWorkspaceAccess)
// ══════════════════════════════════════════════════════

// GET /api/outcomes/overview — Multi-workspace overview
// LITERAL route — must come BEFORE param routes to avoid shadowing
router.get('/api/outcomes/overview', requireAuth, async (_req, res) => {
  try {
    const workspaces = listWorkspaces();
    const overviews: WorkspaceOutcomeOverview[] = [];

    for (const ws of workspaces) {
      const counts = getWorkspaceCounts(ws.id);
      const topWins = getTopWinsForWorkspace(ws.id, 1);
      const scorecard = computeScorecard(ws.id);

      // Determine if attention is needed
      let attentionNeeded = false;
      let attentionReason: string | undefined;
      if (counts.pending > 10) {
        attentionNeeded = true;
        attentionReason = `${counts.pending} actions awaiting measurement`;
      } else if (scorecard.trend === 'declining') {
        attentionNeeded = true;
        attentionReason = 'Win rate is declining';
      }

      // Count actions scored in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const recentActions = getActionsByWorkspace(ws.id);
      let scoredLast30d = 0;
      for (const a of recentActions) {
        const outcomes = getOutcomesForAction(a.id);
        if (outcomes.some(o => o.measuredAt >= thirtyDaysAgo)) scoredLast30d++;
      }

      overviews.push({
        workspaceId: ws.id,
        workspaceName: ws.name,
        winRate: scorecard.overallWinRate,
        trend: scorecard.trend,
        activeActions: counts.pending,
        scoredLast30d,
        topWin: topWins[0] ?? null,
        attentionNeeded,
        attentionReason,
      });
    }

    res.json(overviews);
  } catch (err) {
    log.error({ err }, 'Failed to get outcomes overview');
    res.status(500).json({ error: 'Failed to get outcomes overview' });
  }
});

// GET /api/outcomes/:workspaceId/scorecard — Aggregate stats
router.get('/api/outcomes/:workspaceId/scorecard', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const scorecard = computeScorecard(req.params.workspaceId);
    res.json(scorecard);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get scorecard');
    res.status(500).json({ error: 'Failed to get outcome scorecard' });
  }
});

// GET /api/outcomes/:workspaceId/top-wins — Highest-impact scored outcomes
router.get('/api/outcomes/:workspaceId/top-wins', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const wins = getTopWinsForWorkspace(req.params.workspaceId);
    res.json(wins);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get top wins');
    res.status(500).json({ error: 'Failed to get top wins' });
  }
});

// GET /api/outcomes/:workspaceId/timeline — Action timeline (recent actions)
router.get('/api/outcomes/:workspaceId/timeline', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const actions = getRecentActions(req.params.workspaceId, 50);
    res.json(actions);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get timeline');
    res.status(500).json({ error: 'Failed to get action timeline' });
  }
});

// GET /api/outcomes/:workspaceId/learnings — Current workspace learnings
router.get('/api/outcomes/:workspaceId/learnings', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const learnings = getWorkspaceLearnings(req.params.workspaceId);
    res.json(learnings);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get learnings');
    res.status(500).json({ error: 'Failed to get workspace learnings' });
  }
});

// GET /api/outcomes/:workspaceId/actions — List tracked actions
router.get('/api/outcomes/:workspaceId/actions', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const { type } = req.query;
    let actions: TrackedAction[];
    if (type && typeof type === 'string') {
      actions = getActionsByWorkspaceAndType(req.params.workspaceId, type as ActionType);
    } else {
      actions = getActionsByWorkspace(req.params.workspaceId);
    }

    // Optional score filter
    const { score } = req.query;
    if (score && typeof score === 'string') {
      actions = actions.filter(a => {
        const outcomes = getOutcomesForAction(a.id);
        return outcomes.some(o => o.score === score);
      });
    }

    res.json(actions);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get actions');
    res.status(500).json({ error: 'Failed to get tracked actions' });
  }
});

// GET /api/outcomes/:workspaceId/actions/:actionId — Single action with its outcomes
router.get('/api/outcomes/:workspaceId/actions/:actionId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const action = getAction(req.params.actionId);
    if (!action || action.workspaceId !== req.params.workspaceId) {
      return res.status(404).json({ error: 'Action not found' });
    }
    const outcomes = getOutcomesForAction(req.params.actionId);
    res.json({ ...action, outcomes });
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId, actionId: req.params.actionId }, 'Failed to get action');
    res.status(500).json({ error: 'Failed to get action details' });
  }
});

// POST /api/outcomes/:workspaceId/actions/:actionId/note — Add context note
router.post(
  '/api/outcomes/:workspaceId/actions/:actionId/note',
  requireWorkspaceAccess('workspaceId'),
  validate(z.object({ note: z.string().min(1).max(1000) })),
  (req, res) => {
    try {
      const action = getAction(req.params.actionId);
      if (!action || action.workspaceId !== req.params.workspaceId) {
        return res.status(404).json({ error: 'Action not found' });
      }
      const existingNotes = action.context.notes ?? '';
      const updatedContext = {
        ...action.context,
        notes: existingNotes ? `${existingNotes}\n${req.body.note}` : req.body.note,
      };
      updateActionContext(req.params.actionId, updatedContext);
      res.json({ success: true });
    } catch (err) {
      log.error({ err, workspaceId: req.params.workspaceId, actionId: req.params.actionId }, 'Failed to add note');
      res.status(500).json({ error: 'Failed to add note' });
    }
  },
);

// ══════════════════════════════════════════════════════
// CLIENT (PUBLIC) ROUTES
// ══════════════════════════════════════════════════════

// GET /api/public/outcomes/:workspaceId/summary — Tiered summary (scorecard)
router.get('/api/public/outcomes/:workspaceId/summary', requireClientPortalAuth(), (req, res) => {
  try {
    const scorecard = computeScorecard(req.params.workspaceId);
    // Simplified view for clients
    res.json({
      overallWinRate: scorecard.overallWinRate,
      totalTracked: scorecard.totalTracked,
      totalScored: scorecard.totalScored,
      trend: scorecard.trend,
      byCategory: scorecard.byCategory,
    });
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get client summary');
    res.status(500).json({ error: 'Failed to get outcome summary' });
  }
});

// GET /api/public/outcomes/:workspaceId/wins — "We Called It" entries
router.get('/api/public/outcomes/:workspaceId/wins', requireClientPortalAuth(), (req, res) => {
  try {
    const wins = getTopWinsForWorkspace(req.params.workspaceId, 10);
    // Transform to WeCalledItEntry shape for client view
    const entries: WeCalledItEntry[] = wins.map(w => ({
      actionId: w.actionId,
      actionType: w.actionType,
      pageUrl: w.pageUrl,
      targetKeyword: w.targetKeyword,
      recommendation: `${w.actionType.replace(/_/g, ' ')} action`,
      delta: w.delta,
      detectedAt: w.scoredAt,
    }));
    res.json(entries);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get client wins');
    res.status(500).json({ error: 'Failed to get outcome wins' });
  }
});

// GET /api/outcomes/:workspaceId/playbooks — Action playbook patterns
router.get('/api/outcomes/:workspaceId/playbooks', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const playbooks: ActionPlaybook[] = getPlaybooks(req.params.workspaceId);
    res.json(playbooks);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get playbooks');
    res.status(500).json({ error: 'Failed to get playbooks' });
  }
});

export default router;
