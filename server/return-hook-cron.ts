// server/return-hook-cron.ts
//
// The Issue (Client) P1c — weekly email return-hook cron.
//
// Shares weekly workspace-cron primitives with briefing/strategy Issue while keeping
// return-hook-specific eligibility and send semantics local:
//
// - Polls every hour. At most ONCE per ISO week per eligible workspace it assembles the weekly
//   "what came in" digest (new customers/leads + new measured money + a decision still waiting) and,
//   ONLY when ≥1 section has real content (DR-1), queues ONE `client_return_hook` email through the
//   existing queue → batch → send pipeline. It then stamps `last_return_hook_sent_week_of` ONLY on a
//   confirmed enqueue (notifyClientReturnHook returns false when SMTP is unconfigured / no recipient)
//   and logs an operator-only activity. The ISO-week marker is the SINGLE authoritative ≤1/week cap —
//   `return` is throttle-exempt (a rolling window can't align with the Monday-anchored week), so the
//   throttle can never silently drop a marker-authorized weekly send.
// - Eligibility: feature flag `the-issue-client-return-hook` ON for the workspace AND a configured
//   `clientEmail`. Whole cron is flag-gated globally → tick() returns immediately when OFF
//   (byte-identical OFF: no email, no stamp, no activity).
// - NO-CONTENT (and unconfigured-SMTP) runs do NOT stamp the marker or the in-memory memo, so a later
//   tick the same week can still fire when content appears / SMTP comes online; once a digest is
//   actually enqueued the marker caps it at one send per ISO week.
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
import {
  createIntervalCron,
  currentWeekOfUTC,
  runWithWorkspaceSingleFlight,
} from './weekly-workspace-cron.js';
import type { ReturnHookMoneySection } from '../shared/types/the-issue.js';

const log = createLogger('return-hook-cron');

const FLAG = 'the-issue-client-return-hook';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // poll every hour

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
  return runWithWorkspaceSingleFlight(
    runningSends,
    workspaceId,
    () => ({ status: 'skipped', weekOf: '', reason: 'already running' }),
    () => runReturnHookForWorkspaceInner(workspaceId, opts),
  );
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
        sinceStartDelta: v.baselineDeltaCount ?? null,
        outcomeNoun,
      };
    }
  }

  const hasContent = !!(digest.leads || money || digest.decision);
  // No content → do NOT stamp (week-marker or memo): a later tick this week can fire when content
  // appears. Once a digest IS sent the marker caps it at one send per ISO week.
  if (!hasContent) return { status: 'skipped', weekOf, reason: 'no content' };

  // Enqueue FIRST, then stamp on a confirmed enqueue. notifyClientReturnHook returns false when SMTP
  // is unconfigured or the recipient is absent — in that case we must NOT stamp the week (it would
  // burn the marker on a no-op and the duplicate guard would then suppress the real send all week).
  // queueEmail is synchronous + persists to disk and 'return' is throttle-exempt, so a `true` return
  // means committed delivery; the stamp follows immediately (no async gap to double-send across).
  const enqueued = notifyClientReturnHook({
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
  if (!enqueued) return { status: 'skipped', weekOf, reason: 'email not configured' };

  markReturnHookSentWeek(workspaceId, weekOf);

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

const returnHookCronLifecycle = createIntervalCron({
  startupDelayMs: 90_000,
  intervalMs: CHECK_INTERVAL_MS,
  runStartup: () => {
    try {
      tick();
    } catch (err) {
      log.error({ err }, 'return-hook startup tick failed');
    }
  },
  runInterval: () => {
    try {
      tick();
    } catch (err) {
      log.error({ err }, 'return-hook tick failed');
    }
  },
  onStart: () => log.info('return-hook cron started — checks hourly, at most once per ISO week per eligible workspace'),
});

/** Idempotent — calling twice is a no-op. */
export function startReturnHookCron(): void {
  returnHookCronLifecycle.start();
}

export function stopReturnHookCron(): void {
  returnHookCronLifecycle.stop();
}
