/**
 * The Issue — the drafted "point of view" (spec §4.3).
 *
 * The system drafts a narrated POV over the operator's CURATED rec set (isCuratedForClient),
 * the operator edits it down, and the client reads it (evergreen variant). The resolved shape
 * is the operator override fields ∪ the AI draft fields — callers consume the resolved form
 * (authority-layered: an edited field beats the draft). `version` bumps on every operator edit
 * and is part of the content-hash so a stale POV is never served.
 *
 * Two variants are generated from the same curated set: `admin` keeps a dateline (operator-facing,
 * weekly), `client` is evergreen (no time-relative language). See server/strategy-pov-generator.ts.
 */
export interface StrategyPov {
  /** Narrated status of the site (2-3 sentences). Admin variant may carry a dateline; client is evergreen. */
  situation: string;
  /** The #1 backing rec the lead sentence refers to (null when the curated set is empty). */
  leadMoveRecId: string | null;
  /** The single "the one move I'd bring" sentence, value-first. */
  leadSentence: string;
  /** "Wins worth saying out loud" — short, client-safe. */
  wins: string[];
  /** "What I'd flag" — short, client-safe. */
  flags: string[];
  /**
   * SB-038 (UI-rebuild W1.2) — short admin verdict headline drafted DURING POV generation
   * (server-derived, never client-composed — AD-002). Additive on the pov_json blob (no migration).
   * Optional: absent in pre-SB-038 blobs and until the generator emits one; render nothing when absent.
   */
  verdictHeadline?: string;
  /** Bumps on every operator edit; participates in the cache hash. */
  version: number;
  generatedAt: string;
  /** Set when the operator has edited the draft (override present). */
  editedAt: string | null;
}

/** What the model returns (no version/timestamps — those are stamped by the store). */
export interface StrategyPovAIOutput {
  situation: string;
  leadSentence: string;
  wins: string[];
  flags: string[];
  /** SB-038 — the drafted admin verdict headline (optional; honest absence when the model omits it). */
  verdictHeadline?: string;
}

export type StrategyPovVariant = 'admin' | 'client';

/**
 * Canonical API envelope for every Strategy POV read/write path.
 * `refreshAvailable` is computed from the current effective prompt inputs; it is
 * never inferred by the client from timestamps or recommendation ids.
 */
export interface StrategyPovResponse {
  pov: StrategyPov | null;
  refreshAvailable: boolean;
  /** True when a normal generate found the canonical fingerprint unchanged. */
  unchanged?: boolean;
  /** True when automatic generation preserved an operator edit instead of replacing it. */
  editPreserved?: boolean;
}
