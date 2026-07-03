// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { BadgeTone } from './Badge';

export type KeywordIntent = 'commercial' | 'informational' | 'transactional' | 'local';

/**
 * Canonical keyword-intent → Badge tone map. THE single source of truth going
 * forward. HEAD call sites historically disagreed (transactional→amber at
 * KeywordStrategy.tsx vs →emerald at IssueContentCard.tsx); this map wins. The
 * kit mapped local→purple; remapped to orange here (Four Laws — no purple in
 * client-facing views).
 */
export const INTENT_TONE: Record<KeywordIntent, BadgeTone> = {
  commercial: 'amber',
  informational: 'blue',
  transactional: 'emerald',
  local: 'orange',
};

/** Short forms rendered when `abbreviate` is set (matches the app's .intent). */
export const INTENT_ABBREV: Record<KeywordIntent, string> = {
  commercial: 'Comm',
  informational: 'Info',
  transactional: 'Trans',
  local: 'Local',
};

/**
 * Keyword-intent tag — a convenience over `Badge` (like `StatusBadge` for
 * workflow status). Maps a fixed intent to the canonical tone via INTENT_TONE.
 */
export interface IntentTagProps {
  intent: KeywordIntent;
  /** Render the short form (e.g. "Comm"). */
  abbreviate?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function IntentTag(_props: IntentTagProps): ReactElement {
  throw new Error('F3 stub — IntentTag not yet implemented (Lane A)');
}
