/**
 * The Issue (Client) P0 — GA4 pinned-event outcome aggregation + engagement baseline anchor.
 *
 * - aggregatePinnedOutcomes: sum ONLY the workspace's pinned eventConfig events (label = displayName),
 *   falling back to ALL key-events when none are pinned (with an admin nudge to pin).
 * - computeOutcomeBaseline: workspace/engagement-start-anchored baseline (workspace.createdAt),
 *   read from the earliest ga4_conversion_snapshots row. Mirrors the roi.ts comparison discipline.
 * - ensureEngagementAnchor / backfillGa4SnapshotsFromHistory: seed the durable createdAt anchor from
 *   the GA4 historical API when none exists; degrade honestly (never throw) when GA4 is unavailable.
 */
import { getGA4Conversions } from './google-analytics.js';
import { getEarliestGa4Snapshot, saveGa4Snapshot } from './ga4-snapshots.js';
import { createLogger } from './logger.js';
import type { Workspace } from './workspaces.js';
import type { GA4ConversionSummary } from './google-analytics.js';
import type { IssueOutcomeCount, OutcomeBaseline } from '../shared/types/the-issue.js';

const log = createLogger('the-issue-outcome');

export interface AggregatedOutcomes {
  totalConversions: number;
  units: IssueOutcomeCount['units'];
  usedFallback: boolean;
}

/**
 * Sum the workspace's PINNED eventConfig events from a GA4 byEvent breakdown. Each unit's label is
 * the admin-named `displayName`; `current` is the event's conversion count. When no events are
 * pinned, fall back to ALL key-events (sum everything, label = de-underscored eventName) and flag
 * `usedFallback: true` so the caller can surface the admin nudge to pin.
 */
export function aggregatePinnedOutcomes(
  ws: Pick<Workspace, 'eventConfig'>,
  byEvent: GA4ConversionSummary[],
): AggregatedOutcomes {
  const config = ws.eventConfig ?? [];
  const pinned = config.filter((c) => c.pinned);

  if (pinned.length === 0) {
    // No pinned events — fall back to all key-events.
    const units: IssueOutcomeCount['units'] = byEvent.map((e) => ({
      label: e.eventName.replace(/_/g, ' '),
      current: e.conversions,
      baseline: null,
      priorPeriod: null,
      eventName: e.eventName,
    }));
    const totalConversions = byEvent.reduce((sum, e) => sum + e.conversions, 0);
    return { totalConversions, units, usedFallback: true };
  }

  const displayByEvent = new Map(pinned.map((c) => [c.eventName, c.displayName]));
  const conversionsByEvent = new Map(byEvent.map((e) => [e.eventName, e.conversions]));

  // Preserve the admin's pin order; only emit pinned events that appear in the GA4 breakdown
  // OR have a known display name (emit 0 for a pinned-but-absent event so the unit still shows).
  const units: IssueOutcomeCount['units'] = [];
  let totalConversions = 0;
  for (const c of pinned) {
    const current = conversionsByEvent.get(c.eventName) ?? 0;
    totalConversions += current;
    units.push({
      label: displayByEvent.get(c.eventName) ?? c.eventName.replace(/_/g, ' '),
      current,
      baseline: null,
      priorPeriod: null,
      eventName: c.eventName,
    });
  }
  return { totalConversions, units, usedFallback: false };
}

/**
 * Workspace/engagement-start-anchored baseline. engagementStart is fixed to workspace.createdAt;
 * baselineConversions comes from the earliest ga4_conversion_snapshots row (the durable anchor).
 * `establishing` until one exists; `ready` once it does — never a fabricated delta.
 */
export function computeOutcomeBaseline(ws: Pick<Workspace, 'id' | 'createdAt' | 'eventConfig'>): OutcomeBaseline {
  const engagementStart = ws.createdAt;
  const earliest = getEarliestGa4Snapshot(ws.id);
  if (!earliest) {
    return { engagementStart, baselineConversions: null, baselineCapturedAt: null, state: 'establishing' };
  }
  // Re-aggregate the anchor snapshot through the SAME pinned-event filter the current outcome count
  // uses, so baselineDeltaCount compares like-for-like (pinned-vs-pinned). Using the snapshot's raw
  // all-events `totalConversions` here would subtract an all-events baseline from a pinned-only
  // current and invert the "vs. when we started" delta whenever the anchor had non-pinned events.
  const baselineConversions = aggregatePinnedOutcomes(ws, earliest.byEvent).totalConversions;
  return {
    engagementStart,
    baselineConversions,
    baselineCapturedAt: earliest.capturedAt,
    state: 'ready',
  };
}

/**
 * Seed the durable engagement-start anchor at workspace.createdAt from the GA4 historical API when
 * no snapshot exists. On GA4 error/empty (legacy workspaces beyond GA4 retention) this degrades
 * honestly: it logs a warning and returns — NEVER throws (FM-2). The baseline simply stays
 * `establishing` until forward snapshots accrue.
 */
export async function ensureEngagementAnchor(ws: Pick<Workspace, 'id' | 'createdAt' | 'ga4PropertyId'>): Promise<void> {
  if (getEarliestGa4Snapshot(ws.id)) return; // anchor already exists
  if (!ws.ga4PropertyId) return;             // can't backfill without a GA4 property
  const day = ws.createdAt.slice(0, 10);
  try {
    const summary = await getGA4Conversions(ws.ga4PropertyId, undefined, { startDate: day, endDate: day });
    if (!summary || summary.length === 0) {
      log.warn({ workspaceId: ws.id, day }, 'ensureEngagementAnchor: GA4 returned no conversions for createdAt — leaving baseline establishing');
      return;
    }
    const totalConversions = summary.reduce((sum, e) => sum + e.conversions, 0);
    const totalUsers = summary.reduce((max, e) => Math.max(max, e.users), 0);
    saveGa4Snapshot({
      workspaceId: ws.id,
      capturedAt: ws.createdAt, // stamp the anchor at engagement start, not "now"
      totalConversions,
      totalUsers,
      byEvent: summary,
    });
  } catch (err) {
    log.warn({ err, workspaceId: ws.id }, 'ensureEngagementAnchor: GA4 historical backfill failed — baseline stays establishing (honest degradation)');
  }
}

/** Thin wrapper used by the snapshot cron + tests — seeds the engagement anchor if missing. */
export async function backfillGa4SnapshotsFromHistory(ws: Pick<Workspace, 'id' | 'createdAt' | 'ga4PropertyId'>): Promise<void> {
  await ensureEngagementAnchor(ws);
}
