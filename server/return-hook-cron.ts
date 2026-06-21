// server/return-hook-cron.ts
//
// The Issue (Client) P1c — weekly email return-hook cron.
//
// Clone of strategy-issue-cron.ts, re-pointed at the CLIENT email digest:
//
// - Polls every hour. At most ONCE per ISO week per eligible workspace it assembles the weekly
//   "what came in" digest (new customers/leads + new measured money + a decision still waiting) and,
//   ONLY when ≥1 section has real content (DR-1), queues ONE `client_return_hook` email through the
//   existing queue → throttle → batch → send pipeline, stamps `last_return_hook_sent_week_of`
//   (cross-process idempotency), and logs an operator-only activity.
// - Eligibility: feature flag `the-issue-client-return-hook` ON for the workspace AND a configured
//   `clientEmail`. Whole cron is flag-gated globally → tick() returns immediately when OFF
//   (byte-identical OFF: no email, no stamp, no activity).
// - NO-CONTENT weeks do NOT stamp the marker or the in-memory memo, so a later tick the same week can
//   still fire when content appears — but the marker + throttle cap it at one send per ISO week.
// - Money section is activity-gated (DR-8): present only when there were new leads this week AND the
//   verdict is measured_action/actual_reconciled with a value (DR-9) — never a static weekly restate.
// - Per-workspace single-flight mutex mirrors strategy-issue-cron's runningPushes.
//
// Email only (NO SMS). No new transport/queue/template framework — all reuse.

import {
  listWorkspaces,
  getWorkspace,
  getClientPortalUrl,
  markReturnHookSentWeek,
  resolveSegmentProfile,
} from './workspaces.js';
import { isFeatureEnabled } from './feature-flags.js';
import { computeROI } from './roi.js';
import { assembleReturnHookDigest } from './the-issue-return-hook.js';
import { notifyClientReturnHook } from './email.js';
import { addActivity } from './activity-log.js';
import { createLogger } from './logger.js';
import type { ReturnHookMoneySection } from '../shared/types/the-issue.js';

const log = createLogger('return-hook-cron');

const FLAG = 'the-issue-client-return-hook';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // poll every hour

// ── Time helper ────────────────────────────────────────────────────────────────
// Local copy of strategy-issue-cron's currentWeekOfUTC (kept local per that file's convention so the
// crons stay independently editable). ISO date (YYYY-MM-DD) of the Monday anchoring the week of `d`.
function currentWeekOfUTC(d = new Date()): string {
  const day = d.getUTCDay();
  const diffToMonday = (day + 6) % 7; // Sunday(0) → 6 days back to its Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday));
  return monday.toISOString().slice(0, 10);
}

// ── Eligibility ──────────────────────────────────────────────────────────────
function isEligible(workspaceId: string): boolean {
  if (!isFeatureEnabled(FLAG, workspaceId)) return false;
  const ws = getWorkspace(workspaceId);
  return !!ws?.clientEmail;
}

// ── Public runner API ────────────────────────────────────────────────────────

export interface RunReturnHookOptions {
  /** Skip the duplicate-week guard. For a future "send now" admin button. */
  manual?: boolean;
  /** Override "now" for testing. */
  nowMs?: number;
}

export interface RunReturnHookResult {
  status: 'sent' | 'skipped' | 'duplicate';
  weekOf: string;
  reason?: string;
}

/** Per-process mutex — mirrors strategy-issue-cron's runningPushes (prevents a tick racing a future send-now). */
const runningSends = new Set<string>();

/**
 * Run the weekly return-hook for one workspace. Idempotent within an ISO week unless `manual:true`.
 * Returns a result object — never throws on expected control-flow (ineligible/duplicate/no-content).
 */
export function runReturnHookForWorkspace(
  workspaceId: string,
  opts: RunReturnHookOptions = {},
): RunReturnHookResult {
  if (runningSends.has(workspaceId)) {
    return { status: 'skipped', weekOf: '', reason: 'already running' };
  }
  runningSends.add(workspaceId);
  try {
    return runReturnHookForWorkspaceInner(workspaceId, opts);
  } finally {
    runningSends.delete(workspaceId);
  }
}

function runReturnHookForWorkspaceInner(
  workspaceId: string,
  opts: RunReturnHookOptions,
): RunReturnHookResult {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { status: 'skipped', weekOf: '', reason: 'workspace not found' };
  if (!isFeatureEnabled(FLAG, workspaceId)) return { status: 'skipped', weekOf: '', reason: 'flag off' };
  if (!ws.clientEmail) return { status: 'skipped', weekOf: '', reason: 'no client email' };

  const now = opts.nowMs ? new Date(opts.nowMs) : new Date();
  const weekOf = currentWeekOfUTC(now);

  // Duplicate-week guard — manual bypasses. (Backstops the email throttle's weekly 'return' window.)
  if (ws.lastReturnHookSentWeekOf === weekOf && !opts.manual) {
    return { status: 'duplicate', weekOf };
  }

  // Pure-read leads + decisions.
  const digest = assembleReturnHookDigest(workspaceId);
  if (!digest) return { status: 'skipped', weekOf, reason: 'no digest' };

  const seg = resolveSegmentProfile(ws);
  const outcomeNoun = seg.outcomeNounPlural;

  // Money section (DR-8/DR-9): only when there were new leads this week AND the verdict is measured
  // (not an estimate) with a value. computeROI writes a snapshot — fine here (cron is a write context).
  let money: ReturnHookMoneySection | null = null;
  if (ws.outcomeValue && digest.leads) {
    const roi = computeROI(workspaceId);
    const v = roi?.outcomeVerdict;
    if (
      v &&
      (v.provenance === 'measured_action' || v.provenance === 'actual_reconciled') &&
      v.estimatedValue > 0
    ) {
      money = {
        estimatedValue: v.estimatedValue,
        outcomeCount: v.outcomeCount,
        sinceStartDelta: v.baselineDeltaCount ?? null,
        outcomeNoun,
      };
    }
  }

  const hasContent = !!(digest.leads || money || digest.decision);
  // No content → do NOT stamp (week-marker or memo): a later tick this week can fire when content
  // appears. The marker + throttle still cap it at one send per ISO week once it does.
  if (!hasContent) return { status: 'skipped', weekOf, reason: 'no content' };

  // Stamp the week BEFORE the send so a crash between the two cannot double-send.
  markReturnHookSentWeek(workspaceId, weekOf);

  notifyClientReturnHook({
    clientEmail: ws.clientEmail,
    workspaceName: ws.name,
    workspaceId: ws.id,
    outcomeNoun,
    leadCount: digest.leads?.count,
    recentNames: digest.leads?.recentNames,
    moneyValue: money?.estimatedValue,
    sinceStartDelta: money?.sinceStartDelta ?? null,
    pendingCount: digest.decision?.pendingCount,
    dashboardUrl: getClientPortalUrl(ws),
  });

  // Operator-only audit trail (PII-free metadata; client_return_hook_sent is NOT in CLIENT_VISIBLE_TYPES).
  // Best-effort: the email is already queued + the week stamped, so a logging failure must not propagate.
  try {
    addActivity(
      workspaceId,
      'client_return_hook_sent',
      `Weekly return-hook sent to ${ws.name}'s client`,
      undefined,
      {
        weekOf,
        leadCount: digest.leads?.count ?? 0,
        hasMoney: !!money,
        pendingCount: digest.decision?.pendingCount ?? 0,
      },
    );
  } catch (err) {
    log.error({ err, workspaceId, weekOf }, 'return-hook activity log failed (swallowed) — send stands');
  }

  log.info(
    { workspaceId, weekOf, leadCount: digest.leads?.count ?? 0, hasMoney: !!money, pendingCount: digest.decision?.pendingCount ?? 0 },
    'weekly return-hook sent',
  );
  return { status: 'sent', weekOf };
}

// ── Cron loop ────────────────────────────────────────────────────────────────

/** In-memory "already terminal this week" memo. Only stamped for sent/duplicate (NOT no-content). */
const lastTickRunWeek: Record<string, string> = {};

function tick(now = new Date()): void {
  // Whole-cron flag gate: byte-identical OFF when globally off.
  if (!isFeatureEnabled(FLAG)) return;

  const weekOf = currentWeekOfUTC(now);
  for (const ws of listWorkspaces()) {
    if (lastTickRunWeek[ws.id] === weekOf) continue;
    if (!isEligible(ws.id)) continue;
    let result: RunReturnHookResult;
    try {
      result = runReturnHookForWorkspace(ws.id, { nowMs: now.getTime() });
    } catch (err) {
      // Don't memo on error — hourly retries recover transient failures; the DB week-marker still
      // prevents a successful re-send.
      log.error({ err, workspaceId: ws.id }, 'return-hook tick error');
      continue;
    }
    // Memo only terminal results that won't change this week. A 'skipped'/'no content' must NOT memo
    // (content may appear later this week and should still send).
    if (result.status === 'sent' || result.status === 'duplicate') {
      lastTickRunWeek[ws.id] = weekOf;
    }
  }
}

let startupTimeout: ReturnType<typeof setTimeout> | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;

/** Idempotent — calling twice is a no-op. */
export function startReturnHookCron(): void {
  if (tickInterval) return;

  startupTimeout = setTimeout(() => {
    tick();
  }, 90_000);
  startupTimeout.unref?.();

  tickInterval = setInterval(() => {
    try {
      tick();
    } catch (err) {
      log.error({ err }, 'return-hook tick failed');
    }
  }, CHECK_INTERVAL_MS);
  tickInterval.unref?.();

  log.info('return-hook cron started — checks hourly, at most once per ISO week per eligible workspace');
}

export function stopReturnHookCron(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}
