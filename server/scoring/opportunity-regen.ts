/**
 * opportunity-regen — debounced re-rank trigger for event-driven re-ranking
 * (PR7 · Spine B).
 *
 * When a detector writes an opportunity event (decay, competitor, rank_drop),
 * it calls triggerOpportunityRegen(workspaceId). That collapses a burst
 * of events for the same workspace into a SINGLE generateRecommendations() run
 * (debounced 90s), so the queue re-ranks within ~90s of a timing-critical event
 * without thrashing.
 *
 * ═══ DEFAULT-ON BEHAVIOR ═══
 * enqueueOpportunityRegen is built on the shared bridge debouncer using the
 * `opportunity-value-events` source id so bursts of writes for the same workspace
 * collapse into one regen. When the debounce fires, execution serializes through
 * the shared recommendation regen scheduler so event-driven and follow-on refreshes
 * cannot overlap for the same workspace.
 *
 * ═══ CYCLE BREAK ═══
 * recommendations.ts imports the event store (via opportunity-timing.ts). This module
 * keeps the scheduler behind a DYNAMIC import boundary so callers can trigger the
 * debounce synchronously without statically re-closing the recommendations cycle.
 *
 * generateRecommendations itself must NOT call triggerOpportunityRegen (no
 * recursion) — the regen is triggered only by external detectors + the apply tail.
 */
import { debounceBridge } from '../bridge-infrastructure.js';

type RecommendationRegenSchedulerModule = {
  runRecommendationRegen: (workspaceId: string, reason: string) => Promise<void>;
};

/** 90s debounce window (design §5 anti-thrash). */
export const OPPORTUNITY_REGEN_DEBOUNCE_MS = 90_000;

// Lazily created on first trigger (NOT at module load) so that merely importing
// this module — which recommendations.ts does transitively — never invokes
// debounceBridge at load time. That keeps partial vi.mock()s of
// bridge-infrastructure (which omit debounceBridge) from breaking unrelated tests.
let enqueueOpportunityRegen: ReturnType<typeof debounceBridge> | null = null;
function getEnqueue(): ReturnType<typeof debounceBridge> {
  if (!enqueueOpportunityRegen) {
    enqueueOpportunityRegen = debounceBridge('opportunity-value-events', OPPORTUNITY_REGEN_DEBOUNCE_MS);
  }
  return enqueueOpportunityRegen;
}

function schedulerModulePath(): '../recommendation-regen-scheduler.js' {
  return '../recommendation-regen-scheduler.js';
}

/**
 * Schedule a debounced recommendation regen for a workspace in response to an
 * opportunity event. Safe to call from any detector (try/catch isolated at the
 * bridge layer). Multiple calls within the debounce window collapse into one.
 */
export function triggerOpportunityRegen(workspaceId: string): void {
  if (!workspaceId) return;
  getEnqueue()(workspaceId, async () => {
    const { runRecommendationRegen } =
      await import(schedulerModulePath()) as RecommendationRegenSchedulerModule; // dynamic-import-ok - keeps trigger imports from statically joining recommendation generation cycles
    await runRecommendationRegen(workspaceId, 'opportunity_value_event');
  });
}
