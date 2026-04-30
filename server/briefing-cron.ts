// server/briefing-cron.ts
//
// Weekly client-briefing orchestrator (T1.14).
//
// - Polls every hour. Once it's past Monday 14:00 UTC for a given ISO week,
//   eligible workspaces get one run of `runBriefingForWorkspace()` per week
//   (idempotent on `workspaces.last_briefing_run_week_of`).
// - Per-workspace eligibility: tier !== 'free' AND feature flag
//   `client-briefing-v2` enabled.
// - Pre-flight freshness check: if audit/competitor data is stale, defer up
//   to MAX_DEFERRALS times by writing a placeholder draft with an incremented
//   `preflightDeferralCount`. On the next run after MAX_DEFERRALS, generate
//   anyway (better stale than silent).
// - Soft-degrades when `outcome-ai-injection` is OFF: skip the learnings
//   context block but still generate.
// - Auto-publishes when ws.autoPublishBriefings && ws.autoPublishAfterHours === 0.
//
// Layer composition: instructions (briefing-prompt) → buildSystemPrompt
// (prompt-assembly) injects voice DNA + guardrails. Do NOT inline voice DNA
// here.

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import {
  listWorkspaces,
  getWorkspace,
  updateWorkspace,
  computeEffectiveTier,
  getClientPortalUrl,
} from './workspaces.js';
import { getSchedule } from './scheduled-audits.js';
import { isFeatureEnabled } from './feature-flags.js';
import {
  collectAllCandidates,
  topNByMateriality,
} from './briefing-candidates.js';
import {
  upsertBriefingDraft,
  getBriefingByWeek,
  markPublished,
} from './briefing-store.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { addActivity } from './activity-log.js';
import { notifyClientBriefingReady } from './email.js';
import { computeROI } from './roi.js';
import { recordWeeklyBriefingSnapshot } from './workspace-metrics-snapshots.js';
import {
  buildStoryFromInsight,
  buildStoryFromContentGap,
  buildStoryFromWeCalledIt,
  SUPPORTED_INSIGHT_TYPES,
} from './briefing-templates/index.js';
import { getInsightById } from './analytics-insights-store.js';
import { getAction, getOutcomesForAction } from './outcome-tracking.js';
import type { BriefingStory } from '../shared/types/briefing.js';
import type { AnalyticsInsight, MilestoneAttributionData } from '../shared/types/analytics.js';
import { createLogger } from './logger.js';

const log = createLogger('briefing-cron');

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // poll every hour
const TARGET_DAY = 1; // Monday (UTC: Sunday=0, Monday=1)
const TARGET_HOUR_UTC = 14;
const FRESHNESS_AUDIT_DAYS = 8;
const FRESHNESS_COMPETITOR_DAYS = 8;
const MAX_DEFERRALS = 3;

// ── Statement cache ──────────────────────────────────────────────────────────

const briefingCronStmts = createStmtCache(() => ({
  latestCompetitorSnapshot: db.prepare(
    'SELECT MAX(created_at) AS m FROM competitor_snapshots WHERE workspace_id = ?',
  ),
}));

// ── Time helpers ─────────────────────────────────────────────────────────────

/** ISO date (YYYY-MM-DD) of the Monday that anchors the week containing `d`. */
function currentWeekOfUTC(d = new Date()): string {
  const day = d.getUTCDay();
  // Treat Sunday (0) as the *end* of last week so its Monday is 6 days back.
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - diffToMonday,
  ));
  return monday.toISOString().slice(0, 10);
}

/** Has this week's Monday 14:00 UTC already passed? */
function isPastTargetThisWeek(now = new Date()): boolean {
  const day = now.getUTCDay();
  if (day === 0) return false; // Sunday — Monday hasn't arrived yet this week
  if (day === TARGET_DAY && now.getUTCHours() < TARGET_HOUR_UTC) return false;
  return true;
}

// ── Freshness checks ─────────────────────────────────────────────────────────

function isAuditFresh(workspaceId: string): boolean {
  const sched = getSchedule(workspaceId);
  if (!sched?.lastRunAt) return false;
  const last = new Date(sched.lastRunAt).getTime();
  if (Number.isNaN(last)) return false;
  return Date.now() - last < FRESHNESS_AUDIT_DAYS * 86_400_000;
}

/**
 * Returns true if there are no competitor snapshots (workspace doesn't use
 * competitor monitoring) OR the latest snapshot is fresh. Only blocks the
 * briefing when the workspace HAS competitor monitoring AND it's stale.
 */
function isCompetitorFresh(workspaceId: string): boolean {
  try {
    const row = briefingCronStmts().latestCompetitorSnapshot.get(workspaceId) as
      | { m: string | null }
      | undefined;
    if (!row?.m) return true;
    const last = new Date(row.m).getTime();
    if (Number.isNaN(last)) return true;
    return Date.now() - last < FRESHNESS_COMPETITOR_DAYS * 86_400_000;
  } catch (err) {
    // catch-ok — competitor_snapshots may not exist on workspaces without competitive
    // monitoring; missing-table errors are expected degradation. Treat as "fresh"
    // (i.e., not a freshness blocker) so the cron can proceed.
    log.debug({ err, workspaceId }, 'isCompetitorFresh: snapshot read failed; treating as fresh');
    return true;
  }
}

// ── Public runner API ────────────────────────────────────────────────────────

export interface RunBriefingOptions {
  /** Skip duplicate-week guard. Used by the manual "generate now" admin button. */
  manual?: boolean;
  /** Override "now" for testing. */
  nowMs?: number;
}

export interface RunBriefingResult {
  status: 'generated' | 'deferred' | 'skipped' | 'duplicate';
  weekOf: string;
  reason?: string;
}

/**
 * Per-process mutex preventing concurrent runs for the same workspace.
 * Mirrors the runningAudits Set pattern in scheduled-audits.ts. Two AI calls
 * for the same workspace+week (e.g. cron tick racing with admin generate-now)
 * would double-charge AI quota and double-broadcast. The DB-level
 * lastBriefingRunWeekOf guard handles cross-process duplicates after the
 * first one completes; this Set handles the in-process race.
 */
const runningBriefings = new Set<string>();

/**
 * Run the briefing pipeline once for one workspace. Idempotent within an ISO
 * week unless `manual: true`. Returns a result object — never throws on
 * expected control-flow paths (free tier, duplicate, AI-invalid). Re-throws
 * unexpected errors so the cron loop logs them.
 */
export async function runBriefingForWorkspace(
  workspaceId: string,
  opts: RunBriefingOptions = {},
): Promise<RunBriefingResult> {
  // Mutex: refuse concurrent runs for the same workspace
  if (runningBriefings.has(workspaceId)) {
    return { status: 'duplicate', weekOf: '', reason: 'already running' };
  }
  runningBriefings.add(workspaceId);
  try {
    return await runBriefingForWorkspaceInner(workspaceId, opts);
  } finally {
    runningBriefings.delete(workspaceId);
  }
}

async function runBriefingForWorkspaceInner(
  workspaceId: string,
  opts: RunBriefingOptions,
): Promise<RunBriefingResult> {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { status: 'skipped', weekOf: '', reason: 'workspace not found' };

  // Use effective tier so trial-period free-tier workspaces (with active trialEndsAt)
  // are eligible — matches the public endpoint's gating in routes/public-portal.ts.
  // Otherwise trial users would see briefing UI but never get content generated.
  if (computeEffectiveTier(ws) === 'free') {
    return { status: 'skipped', weekOf: '', reason: 'free tier' };
  }

  const now = opts.nowMs ? new Date(opts.nowMs) : new Date();
  const weekOf = currentWeekOfUTC(now);

  // Duplicate-week guard — manual bypasses
  if (ws.lastBriefingRunWeekOf === weekOf && !opts.manual) {
    return { status: 'duplicate', weekOf };
  }

  // Pre-flight freshness check (defers up to MAX_DEFERRALS times)
  const existing = getBriefingByWeek(workspaceId, weekOf);

  // Terminal-state guard — never overwrite admin's published or skipped decision.
  // The store's ON CONFLICT clause ALSO protects these statuses, but short-
  // circuiting here avoids the wasted AI call for manual generate-now triggered
  // on a week the admin already finalized.
  if (existing && (existing.status === 'published' || existing.status === 'skipped')) {
    return { status: 'duplicate', weekOf, reason: `already ${existing.status}` };
  }

  const deferrals = existing?.sourceMetadata?.preflightDeferralCount ?? 0;
  const auditOk = isAuditFresh(workspaceId);
  const compOk = isCompetitorFresh(workspaceId);
  if ((!auditOk || !compOk) && deferrals < MAX_DEFERRALS && !opts.manual) {
    upsertBriefingDraft({
      workspaceId,
      weekOf,
      stories: existing?.stories ?? [],
      sourceMetadata: {
        candidateCount: 0,
        model: 'n/a',
        provider: 'anthropic',
        generationMs: 0,
        preflightDeferralCount: deferrals + 1,
      },
    });
    log.info(
      { workspaceId, weekOf, deferrals: deferrals + 1, auditOk, compOk },
      'briefing pre-flight defer',
    );
    return {
      status: 'deferred',
      weekOf,
      reason: !auditOk ? 'stale audit' : 'stale competitor data',
    };
  }

  // Collect candidates. With zero candidates, skip regardless of manual flag —
  // the AI prompt would otherwise instruct the model to hallucinate 3-5 stories
  // from an empty pool, which auto-publish could then ship as fabricated content.
  // (The plan's "always show ≥1 story" intent is for genuinely-quiet weeks where
  // some signal exists but materiality is low, not for true-empty pools.)
  const candidates = collectAllCandidates(workspaceId);
  if (candidates.length === 0) {
    log.info({ workspaceId, weekOf, manual: !!opts.manual }, 'briefing skipped — no candidates');
    return { status: 'skipped', weekOf, reason: 'no candidates' };
  }

  // Filter to template-dispatchable candidates BEFORE materiality scoring.
  //
  // Phase 2.5a deterministic templates only handle two candidate shapes:
  //   - content_gap (referenceType === 'recommendation' && id.startsWith('gap-'))
  //   - analytics_insight (referenceType === 'analytics_insight'), gated to
  //     the InsightTypes registered in `briefing-templates/index.ts`.
  //
  // The candidate pool ALSO carries audit_delta (period_change candidates
  // from `getSchedule().lastScore`) and non-gap recommendations from
  // `loadRecommendations()`. Neither has a template dispatcher today; the
  // projection loop returned `null` for them, leaving real story-eligible
  // candidates crowded out of the top-10. Devin caught this on PR #380.
  //
  // Filter THEN score — same materiality math, fewer wasted slots.
  const dispatchableCandidates = candidates.filter((c) => {
    // Phase 2.5c — wci- / milestone- prefixed candidates have dedicated
    // dispatch paths in the projection loop below. They don't read from
    // analytics_insights, so the SUPPORTED_INSIGHT_TYPES check doesn't apply.
    if (c.id.startsWith('wci-')) return true;
    if (c.id.startsWith('milestone-')) return true;
    if (c.referenceType === 'analytics_insight') {
      return SUPPORTED_INSIGHT_TYPES.includes(
        // The candidate doesn't carry the insightType directly; we look up
        // the underlying insight by id+workspace and check its discriminator
        // against the dispatcher registry.
        getInsightById(c.referenceId, workspaceId)?.insightType as never,
      );
    }
    return c.referenceType === 'recommendation' && c.id.startsWith('gap-');
  });

  if (dispatchableCandidates.length === 0) {
    log.info({ workspaceId, weekOf, total: candidates.length }, 'briefing skipped — candidates exist but none have a template dispatcher');
    return { status: 'skipped', weekOf, reason: 'no eligible stories' };
  }

  const top = topNByMateriality(dispatchableCandidates, 10);

  // ── Phase 2.5a: deterministic story templates ───────────────────────
  //
  // Replaces the prior AI-call-and-parse step. Each candidate is projected
  // into a BriefingStory by the type-specific template module. Voice rules
  // are enforced at write-time by the pr-check rule "Banned hedge words in
  // briefing templates". No AI call, no parse step, no Zod-on-AI failure
  // mode — the cron's main path is now fully deterministic.
  //
  // The original AI path lives on disk in `briefing-prompt.ts` for
  // Phase 2.5c's optional hero-headline punch + weekly-opener. Phase 2.5d
  // (cleanup) deletes the multi-story narrative path entirely after the
  // deterministic templates have soaked.
  const t0 = Date.now();
  const tier = (ws.tier as 'free' | 'growth' | 'premium' | undefined) ?? 'free';
  const roiData = (() => {
    try { return computeROI(workspaceId); } catch (err) {
      log.debug({ err, workspaceId }, 'roi unavailable for briefing context; templates degrade $-footnote gracefully');
      return null;
    }
  })();
  const templateContext = {
    workspaceId,
    tier,
    avgCPC: roiData?.avgCPC,
  };
  const stories: BriefingStory[] = [];
  for (const candidate of top) {
    let story: BriefingStory | null = null;
    try {
      if (candidate.id.startsWith('wci-')) {
        // Phase 2.5c — weCalledIt. Candidate.referenceId is the action id;
        // re-fetch the action + most-recent strong_win outcome and dispatch
        // through the dedicated template.
        const action = getAction(candidate.referenceId);
        if (action) {
          const outcomes = getOutcomesForAction(action.id);
          const latest = outcomes.length
            ? outcomes.reduce(
                (acc, o) => (Date.parse(o.measuredAt) > Date.parse(acc.measuredAt) ? o : acc),
                outcomes[0],
              )
            : null;
          if (latest) {
            story = buildStoryFromWeCalledIt({ action, outcome: latest }, templateContext);
          }
        }
      } else if (candidate.id.startsWith('milestone-')) {
        // Phase 2.5c — milestone_attribution. Construct a synthetic
        // AnalyticsInsight<'milestone_attribution'> in-memory from the
        // tracked_action + ROI content-item, then route through the same
        // INSIGHT_DISPATCHERS map other types use. No persisted insight row
        // — the dispatch is purely in-memory for this story type.
        const action = getAction(candidate.referenceId);
        if (action && action.pageUrl && roiData?.contentItems) {
          const item = roiData.contentItems.find((ci) => {
            const ciAny = ci as { contentRequestId?: string; pageUrl?: string };
            if (action.sourceId && ciAny.contentRequestId === action.sourceId) return true;
            return ciAny.pageUrl === action.pageUrl;
          }) as { currentClicks?: number; trafficValue?: number; title?: string } | undefined;
          if (item && typeof item.currentClicks === 'number' && item.currentClicks > 0) {
            const cc = item.currentClicks;
            const threshold: MilestoneAttributionData['thresholdCrossed'] =
              cc >= 100 ? 'hundred_clicks' : cc >= 50 ? 'fifty_clicks' : 'first_clicks';
            const daysSinceDelivery = Math.floor(
              (Date.now() - Date.parse(action.createdAt)) / 86400_000,
            );
            const data: MilestoneAttributionData = {
              briefId: action.sourceId ?? action.id,
              briefTitle: item.title ?? action.targetKeyword ?? 'this brief',
              pageUrl: action.pageUrl,
              thresholdCrossed: threshold,
              currentClicks: cc,
              daysSinceDelivery: Math.max(0, daysSinceDelivery),
              trafficValue: typeof item.trafficValue === 'number' ? item.trafficValue : 0,
            };
            const synthetic: AnalyticsInsight<'milestone_attribution'> = {
              id: `milestone-${data.briefId}`,
              workspaceId,
              insightType: 'milestone_attribution',
              pageId: null,
              pageTitle: data.briefTitle,
              data,
              severity: 'positive',
              impactScore: candidate.impact,
              computedAt: new Date().toISOString(),
            };
            story = buildStoryFromInsight(synthetic, templateContext);
          }
        }
      } else if (candidate.referenceType === 'recommendation' && candidate.id.startsWith('gap-')) {
        const gap = ws.keywordStrategy?.contentGaps?.find(
          (g) => g.targetKeyword === candidate.referenceId,
        );
        if (gap) story = buildStoryFromContentGap(gap, templateContext);
      } else if (candidate.referenceType === 'analytics_insight') {
        const insight = getInsightById(candidate.referenceId, workspaceId);
        if (insight) story = buildStoryFromInsight(insight, templateContext);
      }
    } catch (err) {
      log.debug({ err, workspaceId, candidateId: candidate.id }, 'template projection failed; skipping candidate');
    }
    if (story) stories.push(story);
  }
  const generationMs = Date.now() - t0;

  if (stories.length === 0) {
    log.info({ workspaceId, weekOf, candidateCount: top.length }, 'briefing skipped — every candidate rejected by templates');
    return { status: 'skipped', weekOf, reason: 'no eligible stories' };
  }

  // Promote the highest-impact lead-eligible story to hero.
  //
  // Templates set `leadEligible: false` for story types the spec marks as
  // Watch List only (`competitor_alert`, `page_health`, `ctr_opportunity`,
  // `freshness_alert`, `cannibalization`). Lead-eligible templates leave the
  // field undefined (treated as eligible). Category alone is insufficient —
  // multiple Watch-List-only types share `risk` / `opportunity` categories
  // with lead-eligible types, so we filter on the per-story flag instead.
  //
  // Stories arrive in candidate-rank order (highest materiality first), so
  // `findIndex` picks the first lead-eligible. Fallback: if NO story is
  // lead-eligible (every candidate was Watch-List-only — unusual but
  // possible), force-promote stories[0] so the briefing always carries
  // exactly one hero. The Zod schema doesn't enforce ≥1 hero, but the
  // `<HeroStoryCard>` UI assumes one — defensive promotion preserves the
  // contract.
  const heroIndex = stories.findIndex((s) => s.leadEligible !== false);
  if (heroIndex >= 0) {
    stories[heroIndex].isHeadline = true;
  } else {
    // No lead-eligible story — promote the first story regardless. This
    // preserves the "exactly one hero" invariant. Logged so we can detect
    // workspaces stuck in Watch-List-only territory.
    log.info(
      { workspaceId, weekOf, categories: stories.map((s) => s.category) },
      'briefing: no lead-eligible story; promoting first by materiality',
    );
    stories[0].isHeadline = true;
  }

  // Persist
  const draft = upsertBriefingDraft({
    workspaceId,
    weekOf,
    stories,
    sourceMetadata: {
      candidateCount: top.length,
      model: 'deterministic-templates-v1', // sentinel — no AI provider invoked
      provider: 'anthropic', // unused but Zod-required
      generationMs,
      preflightDeferralCount: deferrals,
    },
  });
  updateWorkspace(workspaceId, { lastBriefingRunWeekOf: weekOf });
  addActivity(
    workspaceId,
    'briefing_generated',
    `Briefing draft generated — ${weekOf}`,
    `${stories.length} stories`,
    { briefingId: draft.id },
  );
  broadcastToWorkspace(workspaceId, WS_EVENTS.BRIEFING_GENERATED, {
    briefingId: draft.id,
    weekOf,
    action: 'generated',
  });

  // Phase 2.5c — piggyback metric snapshot on the weekly tick. Captures the
  // metrics that drove this week's pulse data (GSC clicks/impressions/avg-pos,
  // audit score, ROI traffic value) so future briefings can anchor against
  // them ("best week since Mar 17"). Failures are logged but don't fail the
  // cron run — the briefing is already persisted by this point.
  try {
    await recordWeeklyBriefingSnapshot(workspaceId, weekOf);
  } catch (err) {
    log.warn({ workspaceId, weekOf, err: String(err) }, 'snapshot record failed');
  }

  // Auto-publish branch — only when admin opted in AND afterHours = 0 (immediate)
  // AND the global client-briefing-v2 flag is enabled. The flag gate prevents
  // admin manual generate-now from sending client-facing emails / broadcasts
  // for a feature that's still dark-launched. (The cron tick itself also
  // checks the flag at the top of tick(), but generate-now bypasses tick().)
  if (
    isFeatureEnabled('client-briefing-v2') &&
    ws.autoPublishBriefings &&
    (ws.autoPublishAfterHours ?? 24) === 0
  ) {
    const published = markPublished(workspaceId, draft.id, { autoPublished: true });
    if (published) {
      addActivity(
        workspaceId,
        'briefing_auto_published',
        `Briefing auto-published — ${weekOf}`,
        undefined,
        { briefingId: published.id },
      );
      broadcastToWorkspace(workspaceId, WS_EVENTS.BRIEFING_PUBLISHED, {
        briefingId: published.id,
        weekOf,
      });
      if (ws.clientEmail) {
        notifyClientBriefingReady({
          clientEmail: ws.clientEmail,
          workspaceName: ws.name,
          workspaceId,
          weekOf,
          storyCount: published.stories.length,
          heroHeadline: published.stories.find((s) => s.isHeadline)?.headline ?? '',
          // Without this, renderClientBriefingReady's CTA button never renders —
          // client gets a "briefing ready" email with no way to click through.
          dashboardUrl: getClientPortalUrl(ws),
        });
      }
    }
  }

  return { status: 'generated', weekOf };
}

// ── Cron loop ────────────────────────────────────────────────────────────────

/**
 * In-memory "we already ran this workspace this week" memo. Backstops the
 * DB-level idempotency (workspaces.last_briefing_run_week_of) so we don't
 * pound listWorkspaces() and the eligibility checks every hour for already-
 * processed workspaces.
 */
const lastTickRunWeek: Record<string, string> = {};

async function tick(now = new Date()): Promise<void> {
  if (!isPastTargetThisWeek(now)) return;
  const weekOf = currentWeekOfUTC(now);

  if (!isFeatureEnabled('client-briefing-v2')) return;

  const all = listWorkspaces();
  for (const ws of all) {
    if (lastTickRunWeek[ws.id] === weekOf) continue;
    // Use effective tier so trial-period workspaces (tier='free' + active trialEndsAt)
    // are eligible — matches the public endpoint's tier resolution.
    if (computeEffectiveTier(ws) === 'free') continue;
    let result: RunBriefingResult | undefined;
    try {
      // Pass nowMs so runBriefingForWorkspace computes the SAME weekOf the tick
      // captured — eliminates a theoretical drift if a tick spans a week boundary.
      result = await runBriefingForWorkspace(ws.id, { nowMs: now.getTime() });
      log.info({ workspaceId: ws.id, ...result }, 'briefing tick');
    } catch (err) {
      // Don't stamp the memo on error — a transient AI 5xx or DB hiccup would
      // otherwise lock the workspace out of generation for the entire week.
      // Hourly retries cost log volume but recover from transient failures;
      // the DB-level lastBriefingRunWeekOf still prevents successful re-runs.
      // (If chronic-failure log spam ever becomes a real problem, switch to
      // a per-workspace consecutive-error counter that stamps after N>=3.)
      log.error({ err, workspaceId: ws.id }, 'briefing tick error');
      continue;
    }
    // Stamp the in-memory memo only for TERMINAL results. `deferred` must keep
    // retrying on subsequent hourly ticks until either (a) data freshens and
    // generation succeeds, or (b) MAX_DEFERRALS triggers forced generation.
    if (result.status !== 'deferred') lastTickRunWeek[ws.id] = weekOf;
  }
}

let startupTimeout: ReturnType<typeof setTimeout> | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;

/** Idempotent — calling twice is a no-op. */
export function startBriefingCron(): void {
  if (tickInterval) return;

  startupTimeout = setTimeout(() => {
    tick().catch((err) => log.error({ err }, 'first briefing tick failed'));
  }, 60_000);
  startupTimeout.unref?.();

  tickInterval = setInterval(() => {
    tick().catch((err) => log.error({ err }, 'briefing tick failed'));
  }, CHECK_INTERVAL_MS);
  tickInterval.unref?.();

  log.info('briefing cron started — checks hourly, target Monday 14:00 UTC');
}

export function stopBriefingCron(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}
