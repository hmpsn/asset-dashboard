// server/strategy-issue-cron.ts
//
// The Issue — pushed weekly Issue cron (Phase 3).
//
// Shares weekly workspace-cron primitives with briefing/return-hook while keeping
// strategy-specific eligibility and push behavior local:
//
// - Polls every hour. Once per ISO week per ELIGIBLE workspace, it (a) pre-bakes
//   the admin-variant strategy POV via generateStrategyPov (cheap content-hash
//   recompute — POV_UNCHANGED is the no-op path and STILL counts as "ready"),
//   (b) stamps `workspaces.last_issue_pushed_week_of` (cross-process idempotency),
//   and (c) rings the OPERATOR doorbell so the operator opens to a ready draft.
// - Eligibility: feature flag `strategy-the-issue` ON for the workspace AND the
//   workspace has a recommendation set with ≥1 ACTIVE rec (isActiveRec). Nothing
//   to curate otherwise — the admin POV is drafted OVER the active/proposable set
//   (scaled-review fix #1), so isEligible and the admin POV's rec set agree.
// - Per-workspace single-flight mutex (a running Set, mirroring briefing's
//   runningBriefings) prevents a cron tick racing a future "push now" button.
// - The whole cron is gated behind the flag: if `strategy-the-issue` is globally
//   off, tick() returns immediately.
//
// The operator "doorbell" reuses the EXISTING admin notification rail — it does
// NOT invent a new one. Two halves:
//   1. addActivity('strategy_issue_pushed', …) — operator-only activity entry.
//   2. The visible bell entry is derived in `useNotifications` from the polled
//      workspace-overview summary's `issue` block (`issue.ready`, set by the route
//      from the stamp above + the active-rec + not-acted-this-week gate,
//      scaled-review fix #2), which self-refreshes on a 5-minute interval,
//      deep-linking to the standing Strategy page (`seo-strategy`). No frontend
//      handler consumes a pushed-Issue broadcast.

import {
  listWorkspaces,
  getWorkspace,
  markIssuePushedWeek,
} from './workspaces.js';
import { isFeatureEnabled } from './feature-flags.js';
import {
  loadRecommendations,
  isActiveRec,
} from './recommendations.js';
import {
  generateStrategyPov,
  POV_GENERATION_SUPERSEDED,
  POV_REFRESH_AVAILABLE,
  POV_UNCHANGED,
} from './strategy-pov-generator.js';
import { sendRecommendation, markRecommendationAutoSent } from './recommendation-lifecycle.js';
import { mirrorRecommendationToDeliverable } from './domains/inbox/recommendation-dual-write.js';
import { getEarnedEnabledArchetypes } from './strategy-autosend-store.js';
import { recArchetype } from '../shared/types/strategy-archetype.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { addActivity } from './activity-log.js';
import { createLogger } from './logger.js';
import {
  createIntervalCron,
  currentWeekOfUTC,
  runAsyncWithWorkspaceSingleFlight,
} from './weekly-workspace-cron.js';

const log = createLogger('strategy-issue-cron');

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // poll every hour

/**
 * Exported (scaled-review fix #2) so the workspace-overview doorbell summary computes the SAME
 * "this week" the cron stamps — the bell's `ready` flag MUST agree with the cron's week semantics
 * or it would either never light or never clear.
 */
export { currentWeekOfUTC };

// ── Eligibility ──────────────────────────────────────────────────────────────

/**
 * A workspace is eligible for the pushed Issue when the flag is ON for it AND it
 * has something to curate — a recommendation set with ≥1 active rec. Without an
 * active rec the POV would be drafted over an empty curated set, so there is
 * nothing worth ringing the doorbell about.
 */
function isEligible(workspaceId: string): boolean {
  if (!isFeatureEnabled('strategy-the-issue', workspaceId)) return false;
  const set = loadRecommendations(workspaceId);
  if (!set) return false;
  return set.recommendations.some((r) => isActiveRec(r));
}

// ── Public runner API ────────────────────────────────────────────────────────

export interface RunIssuePushOptions {
  /** Skip the duplicate-week guard. Used by a future "push now" admin button. */
  manual?: boolean;
  /** Override "now" for testing. */
  nowMs?: number;
}

export interface RunIssuePushResult {
  status: 'pushed' | 'unchanged' | 'skipped' | 'duplicate';
  weekOf: string;
  reason?: string;
}

/**
 * Per-process mutex preventing concurrent runs for the same workspace. Mirrors
 * runningBriefings in briefing-cron.ts. Two POV pre-bakes for the same workspace
 * (a cron tick racing a future push-now button) would double-run and waste an AI
 * call. The DB-level last_issue_pushed_week_of guard handles cross-process
 * duplicates after the first completes; this Set handles the in-process race.
 */
const runningPushes = new Set<string>();

/**
 * Run the pushed-Issue pipeline once for one workspace. Idempotent within an ISO
 * week unless `manual: true`. Returns a result object — never throws on expected
 * control-flow paths (ineligible, duplicate, unchanged). Re-throws unexpected
 * errors so the cron loop logs them.
 */
export async function runIssuePushForWorkspace(
  workspaceId: string,
  opts: RunIssuePushOptions = {},
): Promise<RunIssuePushResult> {
  return runAsyncWithWorkspaceSingleFlight(
    runningPushes,
    workspaceId,
    () => ({ status: 'duplicate', weekOf: '', reason: 'already running' }),
    () => runIssuePushForWorkspaceInner(workspaceId, opts),
  );
}

async function runIssuePushForWorkspaceInner(
  workspaceId: string,
  opts: RunIssuePushOptions,
): Promise<RunIssuePushResult> {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { status: 'skipped', weekOf: '', reason: 'workspace not found' };

  // Flag + curated-set eligibility. Manual bypasses neither — a push-now on an
  // ineligible workspace is still a no-op (nothing to draft a POV over).
  if (!isEligible(workspaceId)) {
    return { status: 'skipped', weekOf: '', reason: 'not eligible' };
  }

  const now = opts.nowMs ? new Date(opts.nowMs) : new Date();
  const weekOf = currentWeekOfUTC(now);

  // Duplicate-week guard — manual bypasses.
  if (ws.lastIssuePushedWeekOf === weekOf && !opts.manual) {
    return { status: 'duplicate', weekOf };
  }

  // Pre-bake the admin-variant POV. POV_UNCHANGED is the cheap/no-op path (the admin POV's ACTIVE
  // rec-set hash matched the stored hash — the admin variant drafts over the active/proposable set,
  // the same isActiveRec set this cron's isEligible gates on) — the draft is already ready, so it
  // STILL counts as a successful push for idempotency + doorbell purposes.
  let unchanged = false;
  let editPreserved = false;
  try {
    await generateStrategyPov(workspaceId, { variant: 'admin' });
  } catch (err) {
    // brittle: matches the POV_UNCHANGED message string (the generator throws new Error(POV_UNCHANGED)).
    // Compared against the imported sentinel const, not a literal — but it is still a message-equality
    // check, so a future Error reusing that message would be misclassified. No dedicated error class exists.
    if (err instanceof Error && (
      err.message === POV_UNCHANGED
      || err.message === POV_GENERATION_SUPERSEDED
    )) {
      unchanged = true;
    } else if (err instanceof Error && err.message === POV_REFRESH_AVAILABLE) {
      // Effective evidence/voice changed, but the standing draft contains an
      // operator edit. A scheduler is never replacement authority: preserve the
      // draft, mark the cycle ready, and let the UI offer explicit Regenerate.
      unchanged = true;
      editPreserved = true;
    } else {
      // Unexpected (AI 5xx, DB hiccup). Re-throw so the tick logs + retries next
      // hour WITHOUT stamping the week — a transient failure must not lock the
      // workspace out of its push for the rest of the week.
      throw err;
    }
  }

  // Stamp the week BEFORE the doorbell so a crash between the two can't re-ring.
  markIssuePushedWeek(workspaceId, weekOf);

  // ── Ring the operator doorbell (reuse the existing admin notification rail) ──
  // Best-effort: the week is already stamped (the visible `issue.ready` bell derives from that
  // stamp, not from this activity row), so a doorbell failure must NOT propagate — it would skip the
  // Phase-4 auto-send step below (the cron is the ONLY writer of autoSent), silently dropping a
  // whole week's earned auto-sends with no retry. Swallow + log so auto-send stays reachable.
  try {
    // 1) Operator-only activity entry (strategy_issue_pushed is NOT in
    //    CLIENT_VISIBLE_TYPES, so the client never sees it).
    addActivity(
      workspaceId,
      'strategy_issue_pushed',
      `The weekly Issue for ${ws.name} is drafted and ready to curate`,
      editPreserved
        ? 'Evidence or voice changed — the operator-edited draft was preserved and can be refreshed explicitly'
        : unchanged
          ? 'No change since last cycle — the draft was already up to date'
          : undefined,
      { weekOf, unchanged, ...(editPreserved ? { editPreserved: true } : {}) },
    );
  } catch (err) {
    log.error({ err, workspaceId, weekOf }, 'issue doorbell failed (swallowed) — push stands, auto-send proceeds');
  }

  // ── Trust-ladder auto-send (Phase 4) — DARK-LAUNCHED (audit blocker #3) ─────────────────────
  // After the Issue is pushed + stamped + the doorbell rung, auto-send the active recs of every
  // earned+enabled+eligible archetype. GUARDED behind the OFF-by-default child flag
  // `strategy-trust-ladder-autosend`: with the flag OFF (default) auto-send is NOT invoked at all —
  // the doorbell above stands untouched, so no client receives a rec
  // without a manual operator send. The whole step is best-effort: a failure must not roll back the
  // push (the Issue is already drafted and the operator doorbell already queued). Idempotent within
  // the week — a rec sent this cycle is no longer isActiveRec, so a re-run skips it.
  if (isFeatureEnabled('strategy-trust-ladder-autosend', workspaceId)) {
    try {
      runAutoSendForWorkspace(workspaceId, weekOf, ws.name);
    } catch (err) {
      log.error({ err, workspaceId, weekOf }, 'auto-send step failed (swallowed) — Issue push stands');
    }
  }

  log.info({ workspaceId, weekOf, unchanged, editPreserved }, 'weekly Issue pushed — operator doorbell rung');
  return {
    status: unchanged ? 'unchanged' : 'pushed',
    weekOf,
    ...(editPreserved ? { reason: 'operator edit preserved; refresh available' } : {}),
  };
}

/**
 * The Issue — Phase 4 trust-ladder auto-send. For each EARNED + ENABLED + eligible archetype
 * (getEarnedEnabledArchetypes), auto-send every ACTIVE rec of that archetype via the EXACT manual
 * send path: sendRecommendation (the single-writer; also credits the cycle via its chokepoint) →
 * mark autoSent=true (persisted by re-saving the set) → mirrorRecommendationToDeliverable (the
 * client-reaching dual-write). Best-effort per rec: a single rec failure is logged and skipped, the
 * rest proceed. On count>0: an operator-only `strategy_autosent` doorbell activity + a
 * RECOMMENDATIONS_UPDATED broadcast (so the cockpit refreshes). The per-workspace cron mutex already
 * serializes this against a racing push-now.
 *
 * autoSent persistence: sendRecommendation flips clientStatus→sent + stamps sentAt inside its own
 * txn; markRecommendationAutoSent then stamps autoSent through the SAME single-writer (a db.transaction
 * that re-reads the set), so neither write can be clobbered by a concurrent regen.
 */
export function runAutoSendForWorkspace(workspaceId: string, weekOf: string, wsName: string): void {
  const archetypes = getEarnedEnabledArchetypes(workspaceId);
  if (archetypes.length === 0) return;
  const earned = new Set<string>(archetypes);

  // Snapshot the candidate rec ids up front (active recs whose archetype is earned+enabled). We
  // re-resolve isActiveRec per rec at send time via sendRecommendation's transition guard, so a
  // concurrently-sent rec simply fails its transition and is skipped.
  const set = loadRecommendations(workspaceId);
  if (!set) return;
  const candidateIds = set.recommendations
    .filter((r) => isActiveRec(r) && earned.has(recArchetype(r.type)))
    .map((r) => r.id);
  if (candidateIds.length === 0) return;

  let count = 0;
  const sentArchetypes = new Set<string>();
  for (const recId of candidateIds) {
    try {
      const sent = sendRecommendation(workspaceId, recId);
      if (!sent) continue;
      // Stamp autoSent on the freshly-sent rec through the single-writer (markRecommendationAutoSent
      // re-reads the set INSIDE a db.transaction), so a regen committing between the send and this
      // flip cannot clobber the stamp — the same atomicity guard sendRecommendation uses for
      // clientStatus. Returns the updated rec for the mirror.
      const marked = markRecommendationAutoSent(workspaceId, recId);
      // Mirror to the client-deliverable spine — identical to the manual send path. Best-effort
      // (never throws; the send already stands). R4-PR1: the cron now OBSERVES the typed result and
      // records a durable admin-only activity on failure instead of silently swallowing the
      // divergence (a sent rec that never reached the client feed). rec_status_updated is NOT
      // client-visible; guarded so a logging failure can't break the auto-send loop.
      const mirroredRec = marked ?? sent;
      const mirror = mirrorRecommendationToDeliverable(workspaceId, mirroredRec);
      if (!mirror.ok) {
        try {
          addActivity(
            workspaceId,
            'rec_status_updated',
            `Client-deliverable mirror failed for auto-sent "${mirroredRec.title}"`,
            `The recommendation was auto-sent but its unified deliverable mirror did not write (${mirror.error}). The client feed may not show it until reconciled.`,
            { recId: mirroredRec.id, mirrorError: mirror.error, autoSent: true },
          );
        } catch (activityErr) {
          log.error({ err: activityErr, workspaceId, recId: mirroredRec.id }, 'failed to record auto-send mirror-failure activity');
        }
        log.error({ workspaceId, recId: mirroredRec.id, error: mirror.error }, 'auto-send dual-write mirror failed (observed by cron)');
      }
      count++;
      sentArchetypes.add(recArchetype(sent.type));
    } catch (err) {
      // A single rec's send/transition can fail (e.g. it was sent concurrently between snapshot and
      // here → InvalidTransitionError). Skip it; the rest proceed.
      log.warn({ err, workspaceId, recId }, 'auto-send skipped one rec (swallowed)');
    }
  }

  if (count > 0) {
    const archetypeList = [...sentArchetypes];
    // Operator-only doorbell (strategy_autosent is NOT in CLIENT_VISIBLE_TYPES).
    addActivity(
      workspaceId,
      'strategy_autosent',
      `${count} low-risk move${count === 1 ? '' : 's'} auto-sent for ${wsName}`,
      undefined,
      { weekOf, count, archetypes: archetypeList },
    );
    // The cockpit + client feed read the rec set; a RECOMMENDATIONS_UPDATED broadcast refreshes the
    // admin views (DELIVERABLE_SENT, fired per-rec by the mirror, refreshes the client feed).
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, {
      reason: 'auto-send',
      weekOf,
      count,
    });
    log.info({ workspaceId, weekOf, count, archetypes: archetypeList }, 'trust-ladder auto-send complete');
  } else {
    // Audit blocker #3 — observability for the enabled-but-zero case. We had candidates
    // (candidateIds.length > 0, guarded above) yet sent NONE — every send hit an
    // InvalidTransitionError (each already logged per-rec above) or returned null. Without this the
    // batch would silently vanish. Only reachable when the flag is ENABLED (the call site guards on
    // strategy-trust-ladder-autosend), so a 0/unexpected count here is a real signal worth a warn.
    log.warn(
      { workspaceId, weekOf, count, candidateCount: candidateIds.length },
      'trust-ladder auto-send sent zero of its candidate batch',
    );
  }
}

// ── Cron loop ────────────────────────────────────────────────────────────────

/**
 * In-memory "we already ran this workspace this week" memo. Backstops the
 * DB-level idempotency (workspaces.last_issue_pushed_week_of) so we don't
 * re-list + re-check eligibility every hour for already-pushed workspaces.
 */
const lastTickRunWeek: Record<string, string> = {};

async function tick(now = new Date()): Promise<void> {
  // No whole-cron GLOBAL flag gate here: per-workspace `isEligible()` (below) is the
  // authoritative gate — it calls `isFeatureEnabled('strategy-the-issue', ws.id)` and
  // short-circuits BEFORE any recommendation load, so evaluating every workspace is
  // cheap even when the flag is globally off. A global early-exit (`isFeatureEnabled`
  // with no workspaceId) would wrongly skip a workspace that has the flag ON via a
  // per-workspace override while the global default is OFF (e.g. staging pilots).
  const weekOf = currentWeekOfUTC(now);
  const all = listWorkspaces();
  for (const ws of all) {
    if (lastTickRunWeek[ws.id] === weekOf) continue;
    if (!isEligible(ws.id)) continue;
    let result: RunIssuePushResult | undefined;
    try {
      result = await runIssuePushForWorkspace(ws.id, { nowMs: now.getTime() });
      log.info({ workspaceId: ws.id, ...result }, 'issue-push tick');
    } catch (err) {
      // Don't stamp the memo on error — a transient AI 5xx or DB hiccup would
      // otherwise lock the workspace out of its push for the entire week.
      // Hourly retries recover from transient failures; the DB-level
      // last_issue_pushed_week_of still prevents successful re-runs.
      log.error({ err, workspaceId: ws.id }, 'issue-push tick error');
      continue;
    }
    // Stamp the in-memory memo for terminal results (pushed/unchanged/duplicate).
    lastTickRunWeek[ws.id] = weekOf;
  }
}

const strategyIssueCronLifecycle = createIntervalCron({
  startupDelayMs: 90_000,
  intervalMs: CHECK_INTERVAL_MS,
  runStartup: () => {
    tick().catch((err) => log.error({ err }, 'first issue-push tick failed'));
  },
  runInterval: () => {
    tick().catch((err) => log.error({ err }, 'issue-push tick failed'));
  },
  onStart: () => log.info('strategy issue-push cron started — checks hourly, once per ISO week per eligible workspace'),
});

/** Idempotent — calling twice is a no-op. */
export function startStrategyIssueCron(): void {
  strategyIssueCronLifecycle.start();
}

export function stopStrategyIssueCron(): void {
  strategyIssueCronLifecycle.stop();
}
