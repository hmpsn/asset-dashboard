import { describe, it, expect } from 'vitest';
import {
  CLIENT_DELIVERABLE_TRANSITIONS,
  MATRIX_CELL_TRANSITIONS,
  REQUEST_TRANSITIONS,
  getDeliverableTransitions,
  validateTransition,
  InvalidTransitionError,
} from '../../server/state-machines.js';

describe('CLIENT_DELIVERABLE_TRANSITIONS', () => {
  it('allows awaiting_client → changes_requested and back', () => {
    expect(
      validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'awaiting_client', 'changes_requested'),
    ).toBe('changes_requested');
    expect(
      validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'changes_requested', 'awaiting_client'),
    ).toBe('awaiting_client');
  });

  it('allows awaiting_client → declined (the new terminal for client_action)', () => {
    expect(
      validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'awaiting_client', 'declined'),
    ).toBe('declined');
  });

  it('allows draft → awaiting_client and awaiting_client → approved → applied', () => {
    expect(validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'draft', 'awaiting_client')).toBe(
      'awaiting_client',
    );
    expect(validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'awaiting_client', 'approved')).toBe(
      'approved',
    );
    expect(validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'approved', 'applied')).toBe('applied');
  });

  it('rejects approved → awaiting_client (no un-approve in the base map)', () => {
    expect(() =>
      validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'approved', 'awaiting_client'),
    ).toThrow(InvalidTransitionError);
  });

  it('supports the order lifecycle ordered → in_progress → completed', () => {
    expect(validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'ordered', 'in_progress')).toBe(
      'in_progress',
    );
    expect(validateTransition('deliverable', CLIENT_DELIVERABLE_TRANSITIONS, 'in_progress', 'completed')).toBe(
      'completed',
    );
  });
});

describe('getDeliverableTransitions per-type overrides', () => {
  it('copy_section: approved is terminal, changes_requested → draft', () => {
    const copy = getDeliverableTransitions('copy_section');
    expect(copy.approved).toEqual([]);
    expect(copy.changes_requested).toContain('draft');
    expect(() => validateTransition('deliverable', copy, 'approved', 'applied')).toThrow(InvalidTransitionError);
    expect(validateTransition('deliverable', copy, 'changes_requested', 'draft')).toBe('draft');
  });

  it('briefing (notification): no client transitions', () => {
    const briefing = getDeliverableTransitions('briefing');
    expect(briefing.awaiting_client).toBeUndefined();
    expect(() =>
      validateTransition('deliverable', briefing, 'awaiting_client', 'approved'),
    ).toThrow(InvalidTransitionError);
  });

  it('a type with no override returns the base map', () => {
    const redirect = getDeliverableTransitions('redirect');
    expect(redirect.awaiting_client).toEqual(CLIENT_DELIVERABLE_TRANSITIONS.awaiting_client);
  });
});

describe('MATRIX_CELL_TRANSITIONS', () => {
  it('allows planned → keyword_validated and review → approved', () => {
    expect(validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, 'planned', 'keyword_validated')).toBe(
      'keyword_validated',
    );
    expect(validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, 'review', 'approved')).toBe('approved');
  });

  it('rejects published → planned (terminal)', () => {
    expect(() => validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, 'published', 'planned')).toThrow(
      InvalidTransitionError,
    );
  });
});

describe('REQUEST_TRANSITIONS', () => {
  it('allows new → in_review → in_progress → completed → closed', () => {
    expect(validateTransition('request', REQUEST_TRANSITIONS, 'new', 'in_review')).toBe('in_review');
    expect(validateTransition('request', REQUEST_TRANSITIONS, 'in_review', 'in_progress')).toBe('in_progress');
    expect(validateTransition('request', REQUEST_TRANSITIONS, 'in_progress', 'completed')).toBe('completed');
    expect(validateTransition('request', REQUEST_TRANSITIONS, 'completed', 'closed')).toBe('closed');
  });

  it('forbids closed → new (B24)', () => {
    expect(() => validateTransition('request', REQUEST_TRANSITIONS, 'closed', 'new')).toThrow(InvalidTransitionError);
  });
});
