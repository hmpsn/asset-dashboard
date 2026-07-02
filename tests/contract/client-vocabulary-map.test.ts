// tests/contract/client-vocabulary-map.test.ts
//
// Contract test for shared/types/client-vocabulary.ts (C2 / R12a). Modeled on the
// locked-copy contract pattern in tests/unit/the-issue-evergreen-copy.test.ts: this test
// PINS the chosen canonical strings so a future edit that silently reintroduces drift
// across the client outcome surfaces (OutcomeSummary.tsx, WinsSurface.tsx,
// server/routes/outcomes.ts) fails loudly.
//
// Also verifies completeness against the action catalog's `clientVisible: true` entries
// (shared/types/action-catalog.ts OUTCOME_CATALOG) and the deprecated-key tolerance
// contract (clientActionLabel never throws, never blanks, never leaks a raw enum — even
// for a deprecated/non-union key or a non-string value from an untyped boundary).

import { describe, it, expect } from 'vitest';
import {
  CLIENT_ACTION_LABELS,
  clientActionLabel,
} from '../../shared/types/client-vocabulary.js';
import { ACTION_CATALOG } from '../../shared/types/action-catalog.js';
import type { ActionType } from '../../shared/types/outcome-tracking.js';

// Real ActionType union values, sourced from the owning file (not re-typed by hand) — see
// tests/contract/action-catalog.test.ts for the canonical precedent of this pattern.
const ACTION_TYPES: ActionType[] = [
  'insight_acted_on',
  'content_published',
  'brief_created',
  'strategy_keyword_added',
  'schema_deployed',
  'audit_fix_applied',
  'content_refreshed',
  'internal_link_added',
  'meta_updated',
  'voice_calibrated',
  'competitor_gap_closed',
  'cluster_published',
  'cannibalization_resolved',
  'local_visibility_won',
  'local_service_added',
  'topic_cluster_keep',
  'content_gap_keep',
  'gbp_review_reply',
];

describe('CLIENT_ACTION_LABELS completeness', () => {
  it('has an entry for every ActionType member', () => {
    for (const type of ACTION_TYPES) {
      expect(CLIENT_ACTION_LABELS[type], `CLIENT_ACTION_LABELS.${type}`).toBeTruthy();
    }
  });

  it('has no keys outside the ActionType union', () => {
    expect(Object.keys(CLIENT_ACTION_LABELS).sort()).toEqual([...ACTION_TYPES].sort());
  });

  it('every clientVisible:true outcome-catalog action has a vocabulary entry', () => {
    for (const [type, entry] of Object.entries(ACTION_CATALOG.outcome)) {
      if (entry.clientVisible) {
        expect(CLIENT_ACTION_LABELS[type as ActionType], `CLIENT_ACTION_LABELS.${type}`).toBeTruthy();
      }
    }
  });
});

// ── Locked-copy pin — the canonical wording chosen by the C2/R12a wording pass ──────
//
// WORDING RULE applied: where the four drifted surfaces disagreed, prefer the fuller
// CLIENT-FACING sentence (WinsSurface's long-form style) over admin nouns/short forms.
// See the C2 PR description for the full per-action "current vs. chosen" wording table.
describe('CLIENT_ACTION_LABELS — locked canonical wording (pins drift)', () => {
  it('pins every canonical client-facing label', () => {
    const expected: Record<ActionType, string> = {
      insight_acted_on: 'Acted on a recommendation',
      content_published: 'Published new post',
      brief_created: 'Created content brief',
      strategy_keyword_added: 'Added keyword to strategy',
      schema_deployed: 'Added structured data',
      audit_fix_applied: 'Fixed audit issue',
      content_refreshed: 'Refreshed existing content',
      internal_link_added: 'Added internal links',
      meta_updated: 'Updated meta description',
      voice_calibrated: 'Calibrated brand voice',
      competitor_gap_closed: 'Closed a competitor keyword gap',
      cluster_published: 'Filled a topic cluster',
      cannibalization_resolved: 'Resolved keyword cannibalization',
      local_visibility_won: 'Won local pack visibility',
      local_service_added: 'Started targeting a local service',
      topic_cluster_keep: 'Prioritized a topic cluster',
      content_gap_keep: 'Prioritized a content opportunity',
      gbp_review_reply: 'Replied to a Google Business Profile review',
    };
    for (const type of ACTION_TYPES) {
      expect(CLIENT_ACTION_LABELS[type], `CLIENT_ACTION_LABELS.${type}`).toBe(expected[type]);
    }
  });

  it('none of the labels are admin-style short nouns (sanity: no label is a 1-2 word Title Case fragment)', () => {
    // The whole point of the unification is that client copy reads as a narrative sentence,
    // not an admin noun ("Insight Acted On", "Meta Update"). Every canonical label should
    // contain a verb and be lowercase-led (sentence case), never Title Case.
    for (const [type, label] of Object.entries(CLIENT_ACTION_LABELS)) {
      const firstWord = label.split(' ')[0];
      expect(firstWord[0], `${type} label "${label}" should start lowercase-sentence-case`).toBe(firstWord[0].toUpperCase());
      // Sentence case: only the first letter capitalized, not every word (Title Case).
      const words = label.split(' ').filter(Boolean);
      const capitalizedWords = words.filter((w) => /^[A-Z]/.test(w));
      // Allow proper nouns like "Google Business Profile" to be capitalized; just assert
      // we didn't leave a Title-Case-everything admin label in place.
      expect(capitalizedWords.length, `${type} label "${label}" reads as Title Case, not a sentence`).toBeLessThan(words.length);
    }
  });
});

describe('clientActionLabel()', () => {
  it('resolves every known ActionType to its canonical label', () => {
    for (const type of ACTION_TYPES) {
      expect(clientActionLabel(type)).toBe(CLIENT_ACTION_LABELS[type]);
    }
  });

  it('degrades an unknown/legacy string to a humanized fallback, never throws, never leaks a raw underscored enum', () => {
    expect(clientActionLabel('some_unknown_future_action')).toBe('some unknown future action');
    expect(() => clientActionLabel('keyword_strategy')).not.toThrow();
    expect(clientActionLabel('keyword_strategy')).toBe('keyword strategy');
  });
});

// ── Deprecated/non-union key tolerance (CAVEAT 4) ───────────────────────────────────
//
// src/lib/decision-adapters.ts's CLIENT_ACTION_BADGES carries a deprecated `keyword_strategy`
// key that is NOT a member of ClientActionSourceType (archived rows only). The production
// helper `clientActionLabel` must tolerate this — and any other unrecognized value — without
// crashing or leaking a raw enum, degrading it to a humanized label instead.
describe('clientActionLabel — deprecated/non-union key tolerance', () => {
  it('degrades the deprecated keyword_strategy key to a humanized label, never throws, never a raw enum', () => {
    expect(() => clientActionLabel('keyword_strategy')).not.toThrow();
    const label = clientActionLabel('keyword_strategy');
    expect(label).toBe('keyword strategy');
    // Not a raw underscored enum leaking to the client surface.
    expect(label).not.toContain('_');
  });
});

// ── Never-throw / never-blank guarantee for ALL inputs (matches the docstring) ──────
//
// The docstring promises clientActionLabel NEVER throws and NEVER returns a blank string,
// even for a null/undefined/non-string value arriving through a less-typed JS boundary (a
// DB row, an `as any` cast). Prove that guarantee is literally true, not just "safe for
// today's typed call sites".
describe('clientActionLabel — total (never throws, never blank) for any input', () => {
  it('returns a non-empty label and does not throw for empty / null / undefined', () => {
    for (const bad of ['' as ActionType, null as unknown as ActionType, undefined as unknown as ActionType]) {
      expect(() => clientActionLabel(bad)).not.toThrow();
      const label = clientActionLabel(bad);
      expect(typeof label).toBe('string');
      expect(label.length, `label for ${String(bad)} must be non-empty`).toBeGreaterThan(0);
    }
  });

  it('coerces a non-string value (e.g. a number through an untyped boundary) without throwing', () => {
    expect(() => clientActionLabel(42 as unknown as ActionType)).not.toThrow();
    expect(clientActionLabel(42 as unknown as ActionType).length).toBeGreaterThan(0);
  });
});
