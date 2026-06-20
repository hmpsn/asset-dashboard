// ── The Issue (strategy-the-issue) — client money-surface API ──────────────────
//
// Typed fetch wrappers for the Phase 2 evergreen client surface. Two reads + one
// write, all on the PUBLIC client-portal routes (cookie/session auth via the global
// gate — no admin token, no `requireAuth`). Owned by Lane B (client surface).
//
// `actOn` is a durable content REQUEST (retainer greenlight), NOT generation:
// approving a recommendation sets its clientStatus → 'approved' and creates a
// content-request work-queue item server-side. Nothing is pre-generated or
// generated on the fly — the operator works the request later. The canonical
// route (server Track C / audit P2-3) is:
//   POST /api/public/recommendations/:workspaceId/:recId/act-on
// (Route ownership is Track C; this wrapper pins the contract from the client side.)

import { get, getSafe, post } from './client';
import type {
  RecommendationSet,
  ClientFacingRecommendation,
  ClientRecResponseSummary,
} from '../../shared/types/recommendations.ts';

// B3: ClientRecResponseSummary is the SHARED contract (shared/types/recommendations.ts) — the
// server route emits {approved, declined, discussing, recent[]}. This wrapper previously
// re-declared a divergent {approved, discussing, declined, pending} shape (no `recent`, a
// non-existent `pending`), which silently disagreed with the server payload. Import + re-export
// the single shared type so the FE and server never drift.
export type { ClientRecResponseSummary } from '../../shared/types/recommendations.ts';

/**
 * Server response from the act-on (greenlight) write (B3). Mirrors the act-on route's actual
 * JSON: the client-facing projected recommendation + the durable content-request id created by
 * the greenlight. (Previously a divergent {recId, requestId?, clientStatus?} shape.)
 */
export interface ActOnRecommendationResult {
  /** The client-facing projected recommendation after the greenlight (clientStatus 'approved'). */
  recommendation: ClientFacingRecommendation;
  /** The durable content-request id created by the greenlight. */
  requestId: string;
}

export const theIssueApi = {
  /**
   * The evergreen curated feed the client sees — the public `?clientStatus=sent`
   * projection (server Track C / audit P2-5). Client-safe fields only; admin axes
   * (lifecycle/struckAt/cascade/sendChannel) never leak. Resilient: an empty set on
   * a thin/new client, never a throw, so the surface degrades to its content floor.
   */
  feed: (workspaceId: string) =>
    getSafe<RecommendationSet>(
      `/api/public/recommendations/${workspaceId}?clientStatus=sent`,
      {
        workspaceId,
        generatedAt: new Date(0).toISOString(),
        recommendations: [],
        summary: {
          fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0,
          totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: null,
        },
      },
    ),

  /**
   * Pre-aggregated client response counts for the loop footer. Resilient (getSafe):
   * a brand-new client with no responses degrades to all-zero, never an error card.
   */
  recResponses: (workspaceId: string) =>
    getSafe<ClientRecResponseSummary>(
      `/api/public/recommendations/${workspaceId}/responses`,
      { approved: 0, declined: 0, discussing: 0, recent: [] },
    ),

  /**
   * "Act on this" = a durable content REQUEST (retainer greenlight). Sets
   * clientStatus → 'approved' + creates a content-request server-side. Throws on
   * non-2xx so the caller's useMutation onError surfaces it. NEVER triggers
   * generation and NEVER fires the admin-only fixContext.
   */
  actOn: (workspaceId: string, recId: string) =>
    post<ActOnRecommendationResult>(
      `/api/public/recommendations/${workspaceId}/${recId}/act-on`,
      {},
    ),

  /** Raw read kept for parity/testing — the strict GET (throws on error). */
  feedStrict: (workspaceId: string) =>
    get<RecommendationSet>(`/api/public/recommendations/${workspaceId}?clientStatus=sent`),
};
