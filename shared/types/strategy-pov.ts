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
}

export type StrategyPovVariant = 'admin' | 'client';
