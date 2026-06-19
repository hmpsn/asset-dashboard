/**
 * outcomes routes — Outcome Intelligence Engine REST API
 */
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { requireClientPortalAuth } from '../middleware.js';
import { validate, z } from '../middleware/validate.js';
import { createLogger } from '../logger.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { withWorkspaceLock } from '../bridge-infrastructure.js';
import { WS_EVENTS } from '../ws-events.js';
import { listWorkspaces } from '../workspaces.js';
import {
  getAction,
  getActionByWorkspaceAndSource,
  getActionsByWorkspace,
  getActionsByWorkspaceAndType,
  getOutcomesForAction,
  getRecentActions,
  getTopWinsForWorkspace,
  getWorkspaceCounts,
  recordAction,
  updateActionContext,
  WIN_SCORES,
  getOverviewStats,
  getActionIdsByWorkspace,
  getWinRateForActionIds,
} from '../outcome-tracking.js';
import { getPlaybooks } from '../outcome-playbooks.js';
import { getWorkspaceLearnings } from '../workspace-learnings.js';
import { loadRecommendations } from '../recommendations.js';
import { getClientAction } from '../client-actions.js';
import { getBrief } from '../content-brief.js';
import { getPost } from '../content-posts-db.js';
import { getContentRequest } from '../content-requests.js';
import type {
  ActionType,
  ActionPlaybook,
  OutcomeScorecard,
  WorkspaceOutcomeOverview,
  OutcomeWinEntry,
  LearningsTrend,
  TrackedAction,
  TopWin,
} from '../../shared/types/outcome-tracking.js';
import type { RecommendationSet } from '../../shared/types/recommendations.js';
import { actionTypeEnum, attributionEnum, outcomeScoreEnum } from '../schemas/outcome-schemas.js';
import { invalidateIntelligenceCache } from '../workspace-intelligence.js';

const log = createLogger('outcomes');

const router = Router();

// ── Helpers ──

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

  // Determine trend by comparing the recent half against the older half.
  // Comparing recent against overallWinRate is incorrect because overall
  // includes the recent cohort, shrinking the effective delta and making
  // improving/declining harder to trigger than intended.
  const splitIdx = Math.ceil(actions.length / 2);
  const recentActions = actions.slice(0, splitIdx);
  const olderActions = actions.slice(splitIdx);
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
  let olderWins = 0;
  let olderScored = 0;
  for (const a of olderActions) {
    const outcomes = getOutcomesForAction(a.id);
    const scored = outcomes.filter(o => o.score && o.score !== 'insufficient_data' && o.score !== 'inconclusive');
    if (scored.length > 0) {
      olderScored++;
      const latest = scored[scored.length - 1];
      if (WIN_SCORES.includes(latest.score!)) olderWins++;
    }
  }
  const recentWinRate = recentScored > 0 ? recentWins / recentScored : 0;
  const olderWinRate = olderScored > 0 ? olderWins / olderScored : 0;
  const overallWinRate = totalScored > 0 ? totalWins / totalScored : 0;
  let trend: LearningsTrend = 'stable';
  if (recentScored >= 3 && olderScored > 0) {
    if (recentWinRate > olderWinRate + 0.1) trend = 'improving';
    else if (recentWinRate < olderWinRate - 0.1) trend = 'declining';
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

// ══════════════════════════════════════════════════════
// ADMIN ROUTES (requireWorkspaceAccess)
// ══════════════════════════════════════════════════════

// GET /api/outcomes/overview — Multi-workspace overview
// LITERAL route — must come BEFORE param routes to avoid shadowing
//
// A2 (audit #10): replaced the O(W×A) per-action loops with 4 aggregate queries
// per workspace. Behavioral parity contract:
//   - winRate / trend / totalScored / totalWins: match computeScorecard() loop semantics
//     (not_acted_on NOT filtered — computeScorecard includes them)
//   - scoredLast30d: distinct actions with ANY outcome measured in last 30d (any score)
//   - topWin: uses getTopWinsForWorkspace which filters not_acted_on (A1 exclusion)
//   - activeActions: getWorkspaceCounts().pending = COUNT WHERE measurement_complete=0
// See docs/superpowers/plans/2026-06-10-a2-outcomes-overview-sql.md.
router.get('/api/outcomes/overview', (_req, res) => {
  try {
    const workspaces = listWorkspaces();
    const overviews: WorkspaceOutcomeOverview[] = [];

    for (const ws of workspaces) {
      // Single aggregate query replaces getWorkspaceCounts + the scoredLast30d loop
      const stats = getOverviewStats(ws.id);

      // Trend computation: split action IDs into recent/older halves and compare
      // win rates — matches the computeScorecard() split-half trend logic exactly.
      // getActionIdsByWorkspace returns IDs in created_at DESC order (same as getByWorkspace).
      const allIds = getActionIdsByWorkspace(ws.id);
      const splitIdx = Math.ceil(allIds.length / 2);
      const recentIds = allIds.slice(0, splitIdx);
      const olderIds = allIds.slice(splitIdx);
      const recentRate = getWinRateForActionIds(recentIds);
      const olderRate = getWinRateForActionIds(olderIds);
      const overallWinRate = stats.totalScored > 0 ? stats.totalWins / stats.totalScored : 0;
      let trend: LearningsTrend = 'stable';
      if (recentRate.scored >= 3 && olderRate.scored > 0) {
        const recentWinRate = recentRate.wins / recentRate.scored;
        const olderWinRate = olderRate.wins / olderRate.scored;
        if (recentWinRate > olderWinRate + 0.1) trend = 'improving';
        else if (recentWinRate < olderWinRate - 0.1) trend = 'declining';
      }

      // topWin uses the existing prepared query which applies the A1 not_acted_on exclusion
      const topWins = getTopWinsForWorkspace(ws.id, 1);

      // Determine if attention is needed (same thresholds as the loop version)
      let attentionNeeded = false;
      let attentionReason: string | undefined;
      if (stats.pendingCount > 10) {
        attentionNeeded = true;
        attentionReason = `${stats.pendingCount} actions awaiting measurement`;
      } else if (trend === 'declining') {
        attentionNeeded = true;
        attentionReason = 'Win rate is declining';
      }

      overviews.push({
        workspaceId: ws.id,
        workspaceName: ws.name,
        winRate: overallWinRate,
        trend,
        activeActions: stats.pendingCount,
        scoredLast30d: stats.scoredLast30d,
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

// POST /api/outcomes/:workspaceId/actions — Record a new tracked action (admin only)
router.post(
  '/api/outcomes/:workspaceId/actions',
  requireWorkspaceAccess('workspaceId'),
  validate(z.object({
    actionType: actionTypeEnum,
    sourceType: z.string().min(1).max(100),
    sourceId: z.string().max(200).optional(),
    pageUrl: z.string().max(2048).optional(),
    targetKeyword: z.string().max(500).optional(),
    baselineSnapshot: z.object({
      position: z.number().optional(),
      clicks: z.number().optional(),
      impressions: z.number().optional(),
      ctr: z.number().optional(),
      sessions: z.number().optional(),
    }),
    attribution: attributionEnum.optional(),
    measurementWindow: z.number().int().min(7).max(365).optional(),
  })),
  async (req, res) => {
    try {
      const response = await withWorkspaceLock(req.params.workspaceId, async () => {
        // Idempotency: if sourceId is provided, check for existing action in THIS workspace
        if (req.body.sourceId) {
          const existing = getActionByWorkspaceAndSource(req.params.workspaceId, req.body.sourceType, req.body.sourceId);
          if (existing) {
            return { success: true, action: existing, deduplicated: true } as const;
          }
        }

        const action = recordAction({ // recordAction-ok: workspaceId validated by requireWorkspaceAccess middleware
          workspaceId: req.params.workspaceId,
          actionType: req.body.actionType as ActionType,
          sourceType: req.body.sourceType,
          sourceId: req.body.sourceId,
          pageUrl: req.body.pageUrl,
          targetKeyword: req.body.targetKeyword,
          baselineSnapshot: { ...req.body.baselineSnapshot, captured_at: new Date().toISOString() },
          attribution: req.body.attribution,
          measurementWindow: req.body.measurementWindow,
        });

        broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.OUTCOME_ACTION_RECORDED, { actionId: action.id });
        invalidateIntelligenceCache(req.params.workspaceId);
        return { success: true, action } as const;
      });
      res.json(response);
    } catch (err) {
      log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to record action');
      res.status(500).json({ error: 'Failed to record action' });
    }
  },
);

// GET /api/outcomes/:workspaceId/actions — List tracked actions
router.get('/api/outcomes/:workspaceId/actions', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const { type, score } = req.query;
    let actions: TrackedAction[];
    const parsedType = typeof type === 'string' ? actionTypeEnum.safeParse(type) : null;
    if (parsedType?.success) {
      actions = getActionsByWorkspaceAndType(req.params.workspaceId, parsedType.data as ActionType);
    } else {
      actions = getActionsByWorkspace(req.params.workspaceId);
    }

    // Optional score filter
    const parsedScore = typeof score === 'string' ? outcomeScoreEnum.safeParse(score) : null;
    if (parsedScore?.success) {
      actions = actions.filter(a => {
        const outcomes = getOutcomesForAction(a.id);
        return outcomes.some(o => o.score === parsedScore.data);
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
      updateActionContext(req.params.actionId, req.params.workspaceId, updatedContext);
      invalidateIntelligenceCache(req.params.workspaceId);
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
    // Full OutcomeScorecard serialization (E5): the client OutcomeSummary component
    // renders strongWinRate and pendingMeasurement — omitting them produced NaN%.
    // Nothing here is admin-sensitive (aggregate win-rate stats only; no $ values).
    const scorecard = computeScorecard(req.params.workspaceId);
    res.json(scorecard);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get client summary');
    res.status(500).json({ error: 'Failed to get outcome summary' });
  }
});

// Honest generic per-action-type labels for win entries whose source title cannot be
// resolved (E5, audit #5). Replaces the fabricated `"<action_type> action"` string,
// which implied a recommendation title that never existed. Record<ActionType, string>
// keeps this exhaustive — adding an ActionType without a label is a compile error.
const WIN_FALLBACK_LABELS: Record<ActionType, string> = {
  insight_acted_on: 'Acted on a site insight',
  content_published: 'Published new content',
  brief_created: 'Created a content brief',
  strategy_keyword_added: 'Added a keyword to the strategy',
  schema_deployed: 'Deployed structured data',
  audit_fix_applied: 'Applied a technical fix',
  content_refreshed: 'Refreshed existing content',
  internal_link_added: 'Added internal links',
  meta_updated: 'Updated page metadata',
  voice_calibrated: 'Calibrated brand voice',
  competitor_gap_closed: 'Closed a competitor keyword gap',
  cluster_published: 'Filled a topic cluster',
  cannibalization_resolved: 'Resolved keyword cannibalization',
  local_visibility_won: 'Won local pack visibility',
  local_service_added: 'Started targeting a local service',
  // Strategy redesign P2 pre-commit — managed-set keep markers (internal curation, never a
  // scored win; present only to keep this Record<ActionType,…> exhaustive).
  topic_cluster_keep: 'Prioritized a topic cluster',
  content_gap_keep: 'Prioritized a content opportunity',
};

/**
 * Resolve the REAL source title for a win entry via sourceType/sourceId.
 * Falls back to an honest generic action label when the source has no title
 * or no longer exists. `recSet` is lazily loaded once per request by the caller
 * so a 10-win response doesn't re-read the recommendation set 10 times.
 */
function resolveWinTitle(workspaceId: string, win: TopWin, getRecSet: () => RecommendationSet | null): string {
  const fallback = WIN_FALLBACK_LABELS[win.actionType] ?? win.actionType.replace(/_/g, ' ');
  if (!win.sourceId) return fallback;
  try {
    switch (win.sourceType) {
      case 'recommendation': {
        const rec = getRecSet()?.recommendations.find(r => r.id === win.sourceId);
        return rec?.title || fallback;
      }
      case 'client_action': {
        const action = getClientAction(workspaceId, win.sourceId);
        return action?.title || fallback;
      }
      case 'post':
      case 'content_post': {
        const post = getPost(workspaceId, win.sourceId);
        return post?.title || fallback;
      }
      case 'brief':
      case 'content_brief': {
        const brief = getBrief(workspaceId, win.sourceId);
        return brief?.suggestedTitle || fallback;
      }
      case 'content_request': {
        const request = getContentRequest(workspaceId, win.sourceId);
        return request?.topic || fallback;
      }
      default:
        return fallback;
    }
  } catch (err) {
    // Title resolution is best-effort display enrichment — never fail the wins read.
    log.warn({ err, workspaceId, sourceType: win.sourceType, sourceId: win.sourceId }, 'Failed to resolve win source title');
    return fallback;
  }
}

// GET /api/public/outcomes/:workspaceId/wins — "We Called It" entries
router.get('/api/public/outcomes/:workspaceId/wins', requireClientPortalAuth(), (req, res) => {
  try {
    const workspaceId = req.params.workspaceId;
    const wins = getTopWinsForWorkspace(workspaceId, 10);
    // Lazy once-per-request recommendation set for title resolution
    let recSet: RecommendationSet | null | undefined;
    const getRecSet = () => {
      if (recSet === undefined) recSet = loadRecommendations(workspaceId);
      return recSet;
    };
    // Transform to OutcomeWinEntry shape for client view
    const entries: OutcomeWinEntry[] = wins.map(w => ({
      actionId: w.actionId,
      actionType: w.actionType,
      pageUrl: w.pageUrl,
      targetKeyword: w.targetKeyword,
      recommendation: resolveWinTitle(workspaceId, w, getRecSet),
      delta: w.delta,
      score: w.score,
      attributedValue: w.attributedValue,
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

// GET /api/outcomes/:workspaceId/diagnostics — Pipeline health diagnostics (admin only)
router.get('/api/outcomes/:workspaceId/diagnostics', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const wsId = req.params.workspaceId;
    const actions = getActionsByWorkspace(wsId);
    const counts = getWorkspaceCounts(wsId);
    const playbooks = getPlaybooks(wsId);
    const learnings = getWorkspaceLearnings(wsId);

    // Anomaly detection
    const emptyBaselines: string[] = [];
    const relativeUrls: string[] = [];
    const overdueScoring: string[] = [];
    const orphanedOutcomes: string[] = [];
    const now = Date.now();

    for (const action of actions) {
      // Actions with empty baselines (no position, clicks, or impressions)
      const b = action.baselineSnapshot;
      if (b.position === undefined && b.clicks === undefined && b.impressions === undefined) {
        emptyBaselines.push(action.id);
      }

      // Relative URLs (missing protocol)
      if (action.pageUrl && !action.pageUrl.startsWith('http')) {
        relativeUrls.push(action.id);
      }

      // Overdue for scoring: pending + created > measurementWindow days ago
      if (!action.measurementComplete) {
        const ageMs = now - new Date(action.createdAt).getTime();
        const windowMs = action.measurementWindow * 24 * 60 * 60 * 1000;
        if (ageMs > windowMs) {
          overdueScoring.push(action.id);
        }
      }

      // Orphaned outcomes: outcomes referencing actions that are complete but have no win/loss score
      const outcomes = getOutcomesForAction(action.id);
      for (const o of outcomes) {
        if (o.score === null) {
          orphanedOutcomes.push(`${action.id}:${o.checkpointDays}d`);
        }
      }
    }

    // Outcome counts per score
    const scoreCounts: Record<string, number> = {};
    for (const action of actions) {
      const outcomes = getOutcomesForAction(action.id);
      for (const o of outcomes) {
        const key = o.score ?? 'null';
        scoreCounts[key] = (scoreCounts[key] ?? 0) + 1;
      }
    }

    res.json({
      workspaceId: wsId,
      featureEnabled: true,
      tableCounts: {
        trackedActions: counts.total,
        scored: counts.scored,
        pending: counts.pending,
        playbooks: playbooks.length,
        learnings: learnings ? 1 : 0,
      },
      scoreCounts,
      anomalies: {
        emptyBaselines,
        relativeUrls,
        overdueScoring,
        orphanedOutcomes,
      },
      anomalySummary: {
        emptyBaselines: emptyBaselines.length,
        relativeUrls: relativeUrls.length,
        overdueScoring: overdueScoring.length,
        orphanedOutcomes: orphanedOutcomes.length,
      },
    });
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get diagnostics');
    res.status(500).json({ error: 'Failed to get diagnostics' });
  }
});

export default router;
