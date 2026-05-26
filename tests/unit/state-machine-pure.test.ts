/**
 * Pure unit tests for server/state-machines.ts.
 *
 * Covers: validateTransition(), InvalidTransitionError, and every transition map
 * exported from state-machines.ts — approval items, content requests, posts,
 * work orders, content subscriptions, client actions, briefing drafts, background jobs.
 *
 * This file focuses on structural invariants and cross-map properties that
 * complement the per-entity happy/sad path tests in state-machines.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  validateTransition,
  InvalidTransitionError,
  APPROVAL_ITEM_TRANSITIONS,
  CONTENT_REQUEST_TRANSITIONS,
  POST_STATUS_TRANSITIONS,
  WORK_ORDER_TRANSITIONS,
  CONTENT_SUB_TRANSITIONS,
  CLIENT_ACTION_TRANSITIONS,
  BRIEFING_DRAFT_TRANSITIONS,
  BACKGROUND_JOB_TRANSITIONS,
} from '../../server/state-machines.js';

// ── InvalidTransitionError class ──

describe('InvalidTransitionError class', () => {
  it('is an instance of Error', () => {
    const err = new InvalidTransitionError('item', 'pending', 'applied');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of InvalidTransitionError', () => {
    const err = new InvalidTransitionError('item', 'pending', 'applied');
    expect(err).toBeInstanceOf(InvalidTransitionError);
  });

  it('sets name to InvalidTransitionError', () => {
    const err = new InvalidTransitionError('item', 'pending', 'applied');
    expect(err.name).toBe('InvalidTransitionError');
  });

  it('sets entity, from, to properties', () => {
    const err = new InvalidTransitionError('my_entity', 'from_state', 'to_state');
    expect(err.entity).toBe('my_entity');
    expect(err.from).toBe('from_state');
    expect(err.to).toBe('to_state');
  });

  it('message format: "Invalid <entity> transition: \'<from>\' → \'<to>\'"', () => {
    const err = new InvalidTransitionError('approval', 'applied', 'pending');
    expect(err.message).toBe("Invalid approval transition: 'applied' → 'pending'");
  });

  it('constructor accepts arbitrary string values — no constraint on known states', () => {
    const err = new InvalidTransitionError('test', 'ghost_a', 'ghost_b');
    expect(err.from).toBe('ghost_a');
    expect(err.to).toBe('ghost_b');
  });
});

// ── validateTransition core contract ──

describe('validateTransition — core contract', () => {
  it('returns the to status when the transition is valid', () => {
    const result = validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'pending', 'approved');
    expect(result).toBe('approved');
  });

  it('returned value equals to, not from', () => {
    const result = validateTransition('work_order', WORK_ORDER_TRANSITIONS, 'pending', 'in_progress');
    expect(result).toBe('in_progress');
    expect(result).not.toBe('pending');
  });

  it('throws InvalidTransitionError for an illegal transition', () => {
    expect(() =>
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'applied', 'pending'),
    ).toThrow(InvalidTransitionError);
  });

  it('thrown error also satisfies instanceof Error', () => {
    let caught: unknown;
    try { validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'applied', 'pending'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
  });

  it('throws when from state is unknown in the map', () => {
    expect(() =>
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'unknown_state' as never, 'approved'),
    ).toThrow(InvalidTransitionError);
  });

  it('no self-transitions allowed (none are present in any map)', () => {
    // Spot-check several maps
    expect(() =>
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'pending', 'pending'),
    ).toThrow(InvalidTransitionError);
    expect(() =>
      validateTransition('post', POST_STATUS_TRANSITIONS, 'draft', 'draft'),
    ).toThrow(InvalidTransitionError);
    expect(() =>
      validateTransition('work_order', WORK_ORDER_TRANSITIONS, 'in_progress', 'in_progress'),
    ).toThrow(InvalidTransitionError);
  });

  it('error carries correct entity name from the call site', () => {
    let caught: InvalidTransitionError | null = null;
    try { validateTransition('my_entity', APPROVAL_ITEM_TRANSITIONS, 'applied', 'pending'); }
    catch (e) { caught = e as InvalidTransitionError; }
    expect(caught!.entity).toBe('my_entity');
  });

  it('error carries correct from and to values', () => {
    let caught: InvalidTransitionError | null = null;
    try { validateTransition('work_order', WORK_ORDER_TRANSITIONS, 'completed', 'pending'); }
    catch (e) { caught = e as InvalidTransitionError; }
    expect(caught!.from).toBe('completed');
    expect(caught!.to).toBe('pending');
  });
});

// ── Structural invariants across all maps ──

const ALL_MAPS: Array<{ name: string; map: Record<string, readonly string[]> }> = [
  { name: 'APPROVAL_ITEM', map: APPROVAL_ITEM_TRANSITIONS },
  { name: 'CONTENT_REQUEST', map: CONTENT_REQUEST_TRANSITIONS },
  { name: 'POST_STATUS', map: POST_STATUS_TRANSITIONS },
  { name: 'WORK_ORDER', map: WORK_ORDER_TRANSITIONS },
  { name: 'CONTENT_SUB', map: CONTENT_SUB_TRANSITIONS },
  { name: 'CLIENT_ACTION', map: CLIENT_ACTION_TRANSITIONS },
  { name: 'BRIEFING_DRAFT', map: BRIEFING_DRAFT_TRANSITIONS },
  { name: 'BACKGROUND_JOB', map: BACKGROUND_JOB_TRANSITIONS },
];

describe('Structural invariants — all transition maps', () => {
  it.each(ALL_MAPS)('$name: every map has at least one state', ({ map }) => {
    expect(Object.keys(map).length).toBeGreaterThan(0);
  });

  it.each(ALL_MAPS)('$name: every state lists only states that also exist in the map', ({ map }) => {
    const knownStates = new Set(Object.keys(map));
    for (const [from, tos] of Object.entries(map)) {
      for (const to of tos) {
        expect(knownStates.has(to),
          `${from} → ${to}: target state not in map`).toBe(true);
      }
    }
  });

  it.each(ALL_MAPS)('$name: no state lists itself as a valid transition', ({ map }) => {
    for (const [state, targets] of Object.entries(map)) {
      expect(targets.includes(state), `${state} → ${state} should not be listed`).toBe(false);
    }
  });

  it.each(ALL_MAPS)('$name: at least one terminal state (empty array) exists', ({ map }) => {
    const terminalCount = Object.values(map).filter(t => t.length === 0).length;
    expect(terminalCount).toBeGreaterThan(0);
  });

  it.each(ALL_MAPS)(
    '$name: validateTransition throws for every terminal state → any other state',
    ({ name, map }) => {
      const terminalStates = Object.entries(map)
        .filter(([, targets]) => targets.length === 0)
        .map(([state]) => state);

      for (const terminal of terminalStates) {
        const otherStates = Object.keys(map).filter(s => s !== terminal);
        for (const other of otherStates) {
          expect(
            () => validateTransition(name, map, terminal as never, other),
            `Expected ${terminal} → ${other} to throw`,
          ).toThrow(InvalidTransitionError);
        }
      }
    },
  );
});

// ── APPROVAL_ITEM_TRANSITIONS ──

describe('APPROVAL_ITEM_TRANSITIONS', () => {
  const validate = (from: string, to: string) =>
    validateTransition('approval_item', APPROVAL_ITEM_TRANSITIONS, from, to);

  it('pending → approved is valid', () => {
    expect(validate('pending', 'approved')).toBe('approved');
  });

  it('pending → rejected is valid', () => {
    expect(validate('pending', 'rejected')).toBe('rejected');
  });

  it('approved → pending (undo) is valid', () => {
    expect(validate('approved', 'pending')).toBe('pending');
  });

  it('approved → applied is valid', () => {
    expect(validate('approved', 'applied')).toBe('applied');
  });

  it('rejected → pending (undo) is valid', () => {
    expect(validate('rejected', 'pending')).toBe('pending');
  });

  it('pending → applied (skip) throws', () => {
    expect(() => validate('pending', 'applied')).toThrow(InvalidTransitionError);
  });

  it('applied is terminal — all exits throw', () => {
    for (const s of ['pending', 'approved', 'rejected']) {
      expect(() => validate('applied', s)).toThrow(InvalidTransitionError);
    }
  });
});

// ── POST_STATUS_TRANSITIONS ──

describe('POST_STATUS_TRANSITIONS', () => {
  const validate = (from: string, to: string) =>
    validateTransition('post', POST_STATUS_TRANSITIONS, from, to);

  it('generating → draft', () => expect(validate('generating', 'draft')).toBe('draft'));
  it('generating → error', () => expect(validate('generating', 'error')).toBe('error'));
  it('error → draft (recovery)', () => expect(validate('error', 'draft')).toBe('draft'));
  it('draft → review', () => expect(validate('draft', 'review')).toBe('review'));
  it('review → approved', () => expect(validate('review', 'approved')).toBe('approved'));
  it('review → draft (send back)', () => expect(validate('review', 'draft')).toBe('draft'));

  it('generating → review (must go through draft) throws', () => {
    expect(() => validate('generating', 'review')).toThrow(InvalidTransitionError);
  });

  it('draft → approved (skip review) throws', () => {
    expect(() => validate('draft', 'approved')).toThrow(InvalidTransitionError);
  });

  it('approved is terminal', () => {
    for (const s of ['generating', 'draft', 'review', 'error']) {
      expect(() => validate('approved', s)).toThrow(InvalidTransitionError);
    }
  });
});

// ── WORK_ORDER_TRANSITIONS ──

describe('WORK_ORDER_TRANSITIONS', () => {
  const validate = (from: string, to: string) =>
    validateTransition('work_order', WORK_ORDER_TRANSITIONS, from, to);

  it('pending → in_progress', () => expect(validate('pending', 'in_progress')).toBe('in_progress'));
  it('pending → cancelled', () => expect(validate('pending', 'cancelled')).toBe('cancelled'));
  it('in_progress → completed', () => expect(validate('in_progress', 'completed')).toBe('completed'));
  it('in_progress → cancelled', () => expect(validate('in_progress', 'cancelled')).toBe('cancelled'));

  it('pending → completed (skips in_progress) throws', () => {
    expect(() => validate('pending', 'completed')).toThrow(InvalidTransitionError);
  });

  it('completed and cancelled are both terminal', () => {
    expect(WORK_ORDER_TRANSITIONS['completed']).toEqual([]);
    expect(WORK_ORDER_TRANSITIONS['cancelled']).toEqual([]);
  });
});

// ── CONTENT_SUB_TRANSITIONS ──

describe('CONTENT_SUB_TRANSITIONS', () => {
  const validate = (from: string, to: string) =>
    validateTransition('content_sub', CONTENT_SUB_TRANSITIONS, from, to);

  it('pending → active', () => expect(validate('pending', 'active')).toBe('active'));
  it('active → paused', () => expect(validate('active', 'paused')).toBe('paused'));
  it('active → past_due', () => expect(validate('active', 'past_due')).toBe('past_due'));
  it('paused → active', () => expect(validate('paused', 'active')).toBe('active'));
  it('past_due → active (recovery)', () => expect(validate('past_due', 'active')).toBe('active'));
  it('active → cancelled', () => expect(validate('active', 'cancelled')).toBe('cancelled'));

  it('pending → paused (must activate first) throws', () => {
    expect(() => validate('pending', 'paused')).toThrow(InvalidTransitionError);
  });

  it('cancelled is terminal', () => {
    expect(CONTENT_SUB_TRANSITIONS['cancelled']).toEqual([]);
    for (const s of ['pending', 'active', 'paused', 'past_due']) {
      expect(() => validate('cancelled', s)).toThrow(InvalidTransitionError);
    }
  });
});

// ── CLIENT_ACTION_TRANSITIONS ──

describe('CLIENT_ACTION_TRANSITIONS', () => {
  const validate = (from: string, to: string) =>
    validateTransition('client_action', CLIENT_ACTION_TRANSITIONS, from, to);

  it('pending → approved', () => expect(validate('pending', 'approved')).toBe('approved'));
  it('pending → changes_requested', () =>
    expect(validate('pending', 'changes_requested')).toBe('changes_requested'));
  it('pending → completed', () => expect(validate('pending', 'completed')).toBe('completed'));
  it('pending → archived', () => expect(validate('pending', 'archived')).toBe('archived'));
  it('approved → completed', () => expect(validate('approved', 'completed')).toBe('completed'));
  it('approved → archived', () => expect(validate('approved', 'archived')).toBe('archived'));
  it('changes_requested → pending', () =>
    expect(validate('changes_requested', 'pending')).toBe('pending'));
  it('changes_requested → completed', () =>
    expect(validate('changes_requested', 'completed')).toBe('completed'));
  it('completed → archived', () => expect(validate('completed', 'archived')).toBe('archived'));

  it('approved → pending (must go through changes_requested) throws', () => {
    expect(() => validate('approved', 'pending')).toThrow(InvalidTransitionError);
  });

  it('archived is terminal', () => {
    expect(CLIENT_ACTION_TRANSITIONS['archived']).toEqual([]);
  });
});

// ── BRIEFING_DRAFT_TRANSITIONS ──

describe('BRIEFING_DRAFT_TRANSITIONS', () => {
  const validate = (from: string, to: string) =>
    validateTransition('briefing', BRIEFING_DRAFT_TRANSITIONS, from, to);

  it('draft → approved', () => expect(validate('draft', 'approved')).toBe('approved'));
  it('draft → published', () => expect(validate('draft', 'published')).toBe('published'));
  it('draft → skipped', () => expect(validate('draft', 'skipped')).toBe('skipped'));
  it('approved → published', () => expect(validate('approved', 'published')).toBe('published'));
  it('approved → skipped', () => expect(validate('approved', 'skipped')).toBe('skipped'));
  it('approved → draft (un-approve to edit)', () => expect(validate('approved', 'draft')).toBe('draft'));

  it('published is terminal', () => {
    expect(BRIEFING_DRAFT_TRANSITIONS['published']).toEqual([]);
  });

  it('skipped is terminal', () => {
    expect(BRIEFING_DRAFT_TRANSITIONS['skipped']).toEqual([]);
  });

  it('draft self-transition throws', () => {
    expect(() => validate('draft', 'draft')).toThrow(InvalidTransitionError);
  });
});

// ── BACKGROUND_JOB_TRANSITIONS ──

describe('BACKGROUND_JOB_TRANSITIONS', () => {
  const validate = (from: string, to: string) =>
    validateTransition('background_job', BACKGROUND_JOB_TRANSITIONS, from, to);

  it('pending → running', () => expect(validate('pending', 'running')).toBe('running'));
  it('pending → done (direct)', () => expect(validate('pending', 'done')).toBe('done'));
  it('pending → error', () => expect(validate('pending', 'error')).toBe('error'));
  it('pending → cancelled', () => expect(validate('pending', 'cancelled')).toBe('cancelled'));
  it('running → done', () => expect(validate('running', 'done')).toBe('done'));
  it('running → error', () => expect(validate('running', 'error')).toBe('error'));
  it('running → cancelled', () => expect(validate('running', 'cancelled')).toBe('cancelled'));

  it('running → pending (no rollback) throws', () => {
    expect(() => validate('running', 'pending')).toThrow(InvalidTransitionError);
  });

  it('done, error, cancelled are all terminal', () => {
    expect(BACKGROUND_JOB_TRANSITIONS['done']).toEqual([]);
    expect(BACKGROUND_JOB_TRANSITIONS['error']).toEqual([]);
    expect(BACKGROUND_JOB_TRANSITIONS['cancelled']).toEqual([]);
  });
});

// ── CONTENT_REQUEST_TRANSITIONS ──

describe('CONTENT_REQUEST_TRANSITIONS', () => {
  const validate = (from: string, to: string) =>
    validateTransition('content_request', CONTENT_REQUEST_TRANSITIONS, from, to);

  it('pending_payment → requested', () =>
    expect(validate('pending_payment', 'requested')).toBe('requested'));
  it('pending_payment → declined', () =>
    expect(validate('pending_payment', 'declined')).toBe('declined'));
  it('requested → brief_generated', () =>
    expect(validate('requested', 'brief_generated')).toBe('brief_generated'));
  it('requested → in_progress (admin fast-track)', () =>
    expect(validate('requested', 'in_progress')).toBe('in_progress'));
  it('in_progress → post_review', () =>
    expect(validate('in_progress', 'post_review')).toBe('post_review'));
  it('post_review → delivered', () =>
    expect(validate('post_review', 'delivered')).toBe('delivered'));
  it('delivered → published', () =>
    expect(validate('delivered', 'published')).toBe('published'));

  it('pending_payment → in_progress (skips requested) throws', () => {
    expect(() => validate('pending_payment', 'in_progress')).toThrow(InvalidTransitionError);
  });

  it('published is terminal', () => {
    expect(CONTENT_REQUEST_TRANSITIONS['published']).toEqual([]);
  });

  it('declined is terminal', () => {
    expect(CONTENT_REQUEST_TRANSITIONS['declined']).toEqual([]);
  });

  it('changes_requested → client_review (re-review cycle)', () =>
    expect(validate('changes_requested', 'client_review')).toBe('client_review'));

  it('approved → client_review (backward movement) throws', () => {
    expect(() => validate('approved', 'client_review')).toThrow(InvalidTransitionError);
  });
});

// ── Return value chaining ──

describe('validateTransition return value is chainable', () => {
  it('returned status can be directly assigned to a record field', () => {
    const next = validateTransition('work_order', WORK_ORDER_TRANSITIONS, 'pending', 'in_progress');
    const row = { status: next, id: '123' };
    expect(row.status).toBe('in_progress');
  });

  it('return value satisfies === equality (not just deep equality)', () => {
    const next = validateTransition('post', POST_STATUS_TRANSITIONS, 'review', 'approved');
    expect(next === 'approved').toBe(true);
  });
});
