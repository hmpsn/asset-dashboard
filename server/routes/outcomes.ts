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
import { computeOutcomeCoverage } from '../outcome-coverage.js';
import { getPlaybooks } from '../outcome-playbooks.js';
import { getWorkspaceLearnings } from '../workspace-learnings.js';
import { loadRecommendations } from '../recommendations.js';
import { getClientAction } from '../client-actions.js';
import { getBrief } from '../content-brief.js';
import { getPost } from '../content-posts-db.js';
import { getContentRequest } from '../content-requests.js';
import { clientActionLabel } from '../../shared/types/client-vocabulary.js';
import {
  getActionCatalogEntry,
  toClientSafeOutcomeEventPayload,
} from '../../shared/types/action-catalog.js';
import type {
  ActionType,
  Attribution,
  ActionPlaybook,
  OutcomeScorecard,
  WorkspaceOutcomeOverview,
  OutcomeWinEntry,
  LearningsTrend,
  TrackedAction,
  TopWin,
} from '../../shared/types/outcome-tracking.js';
import type { RecommendationSet } from '../../shared/types/recommendations.js';
import { actionTypeEnum, attributionEnum, outcomeScoreEnum, trackedActionSourceSnapshotSchema } from '../schemas/outcome-schemas.js';
import { invalidateIntelligenceCache } from '../intelligence/cache-invalidation.js';
import { buildOutcomePortfolioRollup } from '../outcome-portfolio-rollup.js';

const log = createLogger('outcomes');

const router = Router();

// ── Helpers ──

/**
 * Compute the outcome scorecard for a workspace.
 *
 * `excludeNotActedOn` (C4 attribution-honesty): when true, `not_acted_on` actions —
 * unexecuted proposals the workspace never acted on — are dropped from ALL rollups
 * (win-rate numerator/denominator, byCategory, totals, trend) so they never inflate
 * a client-facing win rate or "confirmed wins" count. The ADMIN summary route leaves
 * this false to preserve the historical admin-parity semantics (admin surfaces
 * deliberately include not_acted_on for full-funnel visibility — see the /overview
 * parity contract). The PUBLIC summary route passes true. This mirrors the A1
 * exclusion already applied to the wins surfaces (getTopWinsFromActions).
 *
 * `excludeClientHidden` keeps internal-only platform milestones (for example,
 * voice-authority finalization) out of client-facing counts. Unknown historical
 * action values remain visible rather than being silently discarded.
 */
function computeScorecard(
  workspaceId: string,
  opts?: { excludeNotActedOn?: boolean; excludeClientHidden?: boolean },
): OutcomeScorecard {
  const allActions = getActionsByWorkspace(workspaceId);
  const actions = allActions.filter(action => {
    if (opts?.excludeNotActedOn && action.attribution === 'not_acted_on') return false;
    if (opts?.excludeClientHidden) {
      const catalogEntry = getActionCatalogEntry('outcome', action.actionType);
      if (catalogEntry?.clientVisible === false) return false;
    }
    return true;
  });

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

// GET /api/outcomes/portfolio-rollup — GO-004 cross-workspace, windowed proof totals.
// LITERAL route — must come BEFORE param routes to avoid shadowing.
router.get('/api/outcomes/portfolio-rollup', (_req, res) => {
  try {
    res.json(buildOutcomePortfolioRollup());
  } catch (err) {
    log.error({ err }, 'Failed to get outcomes portfolio rollup');
    res.status(500).json({ error: 'Failed to get outcomes portfolio rollup' });
  }
});

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
        // R9 (B15): admin-only coverage funnel summary — cheap indexed aggregate, same shape
        // as the per-workspace endpoint. Never surfaced client-side.
        coverage: computeOutcomeCoverage(ws.id),
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

// GET /api/outcomes/:workspaceId/coverage — Reconcile R9 (B15): admin-only outcome
// coverage funnel (tracked → measured → reconciled). Never exposed on a public/client route.
router.get('/api/outcomes/:workspaceId/coverage', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const coverage = computeOutcomeCoverage(req.params.workspaceId);
    res.json(coverage);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get outcome coverage');
    res.status(500).json({ error: 'Failed to get outcome coverage' });
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
    // R6 (B11): optional source-identity snapshot. Advisory — the API accepts a free-form
    // { label, snapshot } so external/programmatic recorders can capture the source's
    // title at write time. `snapshot.type` stays a free string (mirrors the advisory
    // SourceRef union); no hard enum break.
    source: z.object({
      label: z.string().min(1).max(500),
      snapshot: trackedActionSourceSnapshotSchema.optional(),
    }).optional(),
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

        // R8-PR2 (B14): tolerate-old, HONEST default. recordAction now REQUIRES attribution
        // (the inverted `?? 'platform_executed'` internal default was removed as a trust
        // hazard — it silently over-credited the platform). External callers (MCP holders of
        // persistent API keys, programmatic recorders) that omit attribution keep working —
        // this is a NON-breaking change — but their action is stored with the honest
        // `not_acted_on` ("we don't know / not attributed"), NEVER the silent
        // `platform_executed`, plus a deprecation warn nudging them to send it explicitly.
        const attribution: Attribution = req.body.attribution ?? 'not_acted_on';
        if (req.body.attribution === undefined) {
          log.warn(
            { workspaceId: req.params.workspaceId, sourceType: req.body.sourceType, actionType: req.body.actionType },
            'DEPRECATION: POST /api/outcomes/:workspaceId/actions received no `attribution` — defaulting to the honest `not_acted_on`. ' +
            'Pass an explicit attribution (platform_executed | externally_executed | not_acted_on); the silent default will be removed in a future release.',
          );
        }

        const action = recordAction({ // recordAction-ok: workspaceId validated by requireWorkspaceAccess middleware
          workspaceId: req.params.workspaceId,
          actionType: req.body.actionType as ActionType,
          sourceType: req.body.sourceType,
          sourceId: req.body.sourceId,
          pageUrl: req.body.pageUrl,
          targetKeyword: req.body.targetKeyword,
          baselineSnapshot: { ...req.body.baselineSnapshot, captured_at: new Date().toISOString() },
          attribution,
          measurementWindow: req.body.measurementWindow,
          // R6 (B11): thread the optional source-identity snapshot from the request body.
          source: req.body.source,
        });

        broadcastToWorkspace(
          req.params.workspaceId,
          WS_EVENTS.OUTCOME_ACTION_RECORDED,
          toClientSafeOutcomeEventPayload(action.actionType, { actionId: action.id }),
        );
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
    //
    // C4 (attribution honesty): exclude `not_acted_on` actions — unexecuted proposals
    // the workspace never acted on — from the CLIENT win-rate and confirmed-wins counts.
    // Internal-only platform milestones are excluded for the same reason: they remain
    // useful in admin diagnostics but are not client outcome claims. Admin routes retain
    // the full ledger for operational visibility.
    const scorecard = computeScorecard(req.params.workspaceId, {
      excludeNotActedOn: true,
      excludeClientHidden: true,
    });
    res.json(scorecard);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to get client summary');
    res.status(500).json({ error: 'Failed to get outcome summary' });
  }
});

// Honest generic per-action-type labels for win entries whose source title cannot be
// resolved (E5, audit #5). Replaces the fabricated `"<action_type> action"` string,
// which implied a recommendation title that never existed.
//
// C2/R12a: this fallback now reads the single canonical client vocabulary map
// (shared/types/client-vocabulary.ts) instead of carrying its own
// Record<ActionType, string> — folded together with WinsSurface.tsx's ACTION_LABELS
// and OutcomeSummary.tsx's ACTION_TYPE_LABELS after the owner wording sign-off pass.
// The admin action catalog (`shared/types/action-catalog.ts`, `outcome` context)
// remains a SEPARATE, shorter admin-style label set — this endpoint is CLIENT-visible
// (GET /api/public/outcomes/:workspaceId/wins; WinsSurface.tsx renders
// `entry.recommendation` — this fallback text — directly) and must keep the fuller
// client-facing phrasing, not the admin nouns.
/**
 * Resolve the REAL source title for a win entry.
 *
 * R6 (B11) — resolution order is snapshot → live → generic:
 *   1. SNAPSHOT-FIRST: if the action carried a source title snapshotted at record
 *      time (`win.sourceLabel`), use it. This is the durable identity captured when
 *      the action was recorded, so a regenerated/deleted source no longer degrades
 *      the win to a generic label.
 *   2. LIVE lookup: fall back to reading the source's CURRENT title via
 *      sourceType/sourceId (recommendation set, client action, post, brief, request).
 *      Kept intact for legacy/pre-B11 rows that have no snapshot.
 *   3. GENERIC fallback: an honest per-action-type label when neither resolves. This
 *      fallback is DELIBERATELY retained — its demotion is B12's job, after the
 *      integrity sweep confirms zero danglers. Do not delete it here.
 *
 * `recSet` is lazily loaded once per request by the caller so a 10-win response
 * doesn't re-read the recommendation set 10 times.
 */
function resolveWinTitle(workspaceId: string, win: TopWin, getRecSet: () => RecommendationSet | null): string {
  const fallback = clientActionLabel(win.actionType);
  // 1. Snapshot-first: the write-time captured title, immune to source regeneration.
  const snapshotTitle = win.sourceLabel?.trim();
  if (snapshotTitle) return snapshotTitle;
  // 2. Live lookup (legacy rows / no snapshot captured).
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
    const wins = getTopWinsForWorkspace(workspaceId, 10, { excludeClientHidden: true });
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
      // C4: carry honest execution attribution so WinsSurface frames externally_executed
      // wins truthfully ("we called it") instead of claiming "we shipped it".
      attribution: w.attribution,
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
