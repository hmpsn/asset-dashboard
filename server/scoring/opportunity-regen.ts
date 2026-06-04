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
 * collapse into one regen. When nothing writes events, nothing is enqueued.
 *
 * ═══ CYCLE BREAK ═══
 * recommendations.ts imports the event store (via opportunity-timing.ts). If this
 * regen helper value-imported generateRecommendations back, that would close a
 * cycle that perturbs whole-program type inference (the external-fetch.ts BodyInit
 * ripple). So generateRecommendations is loaded with a DYNAMIC import inside the
 * debounced fn — the same pattern ov-divergence/bridge-infrastructure use. The fn
 * runs in its own try/catch so a regen failure can NEVER surface to the detector.
 *
 * generateRecommendations itself must NOT call triggerOpportunityRegen (no
 * recursion) — the regen is triggered only by external detectors + the apply tail.
 */
import { debounceBridge } from '../bridge-infrastructure.js';
import { createLogger } from '../logger.js';

const log = createLogger('opportunity-regen');

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

/**
 * Schedule a debounced recommendation regen for a workspace in response to an
 * opportunity event. Safe to call from any detector (try/catch isolated at the
 * bridge layer). Multiple calls within the debounce window collapse into one.
 */
export function triggerOpportunityRegen(workspaceId: string): void {
  if (!workspaceId) return;
  getEnqueue()(workspaceId, async () => {
    try {
      // Dynamic import to break the recommendations.ts ↔ event-store cycle.
      const { generateRecommendations } = await import('../recommendations.js'); // dynamic-import-ok
      await generateRecommendations(workspaceId);
      log.info({ workspaceId }, 'event-driven recommendation regen complete');
    } catch (err) {
      log.warn({ workspaceId, err: err instanceof Error ? err.message : String(err) }, 'event-driven rec regen failed (non-fatal)');
    }
  });
}
