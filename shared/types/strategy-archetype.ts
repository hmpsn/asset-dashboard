/**
 * The Issue — operator-legible archetype grouping for recommendations.
 *
 * Pure presentation contract (zero AI, zero new data): every RecType maps to exactly one of
 * six operator/client-legible buckets. Shared by the admin stance bar + backing-moves queue
 * (Phase 1) and the client "also on your plan" grouping (Phase 2). Exhaustiveness is enforced
 * at compile time by `satisfies Record<RecType, Archetype>` and at runtime by the contract test
 * (tests/contract/strategy-archetype-exhaustiveness.test.ts).
 */
import type { RecType } from './recommendations.js';

export type Archetype =
  | 'authority_bet'
  | 'refresh_reclaim'
  | 'defend'
  | 'quick_win'
  | 'technical'
  | 'local';

export const ARCHETYPE_ORDER: Archetype[] = [
  'authority_bet',
  'refresh_reclaim',
  'defend',
  'quick_win',
  'technical',
  'local',
];

// ADMIN-facing labels — used by the admin stance bar / backing-moves queue
// (StanceBar.tsx, BackingMovesQueue.tsx, TrustLadderPanel.tsx). These are
// deliberately terse, operator-legible nouns.
//
// C2/R12a checked this map against the client-facing archetype grouping
// (src/components/client/the-issue/IssueAlsoOnPlanSection.tsx `CLIENT_GROUP_META`)
// for accidental drift and found INTENTIONAL divergence, not drift: the client
// component already carries its own narrative label + one-line description per
// archetype (e.g. "Defend cannibalized" → "Protecting your rankings — Resolving
// overlap so the right page wins"), documented in that file's header as a
// deliberate client-friendly rewrite of this admin vocabulary. A `Record<Archetype,
// string>` can't hold the client's paired label+description, so it is NOT folded
// into this map — kept as two intentionally different, separately-owned label
// sets (same split as shared/types/action-catalog.ts `outcome` vs.
// shared/types/client-vocabulary.ts).
export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  authority_bet: 'New authority bets',
  refresh_reclaim: 'Refresh & reclaim',
  defend: 'Defend cannibalized',
  quick_win: 'Quick wins',
  technical: 'Technical fixes',
  local: 'Local',
};

/** RecType → archetype. All 15 RecTypes bucket cleanly with no overlap. */
export const REC_TYPE_ARCHETYPE = {
  content: 'authority_bet',
  keyword_gap: 'authority_bet',
  topic_cluster: 'authority_bet',
  content_refresh: 'refresh_reclaim',
  cannibalization: 'defend',
  competitor: 'defend',
  strategy: 'quick_win',
  aeo: 'quick_win',
  technical: 'technical',
  metadata: 'technical',
  schema: 'technical',
  performance: 'technical',
  accessibility: 'technical',
  local_visibility: 'local',
  local_service_gap: 'local',
} satisfies Record<RecType, Archetype>;

/**
 * MarketMuse-style "create N / refresh M / defend K" headline verb per archetype.
 * `technical`/`local` sit outside the create/refresh/defend frame and are counted separately.
 */
export const ARCHETYPE_HEADLINE_VERB: Record<Archetype, 'create' | 'refresh' | 'defend' | 'other'> = {
  authority_bet: 'create',
  refresh_reclaim: 'refresh',
  defend: 'defend',
  quick_win: 'create',
  technical: 'other',
  local: 'other',
};

export function recArchetype(type: RecType): Archetype {
  return REC_TYPE_ARCHETYPE[type];
}
