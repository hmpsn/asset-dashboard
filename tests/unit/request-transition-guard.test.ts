/**
 * G2 unit tests: validateTransition guards for REQUEST_TRANSITIONS and MATRIX_CELL_TRANSITIONS.
 *
 * Tests the pure transition-validation logic without hitting the DB.
 * Store-layer integration is tested via state-machine-guard-coverage-contract.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  validateTransition,
  InvalidTransitionError,
  REQUEST_TRANSITIONS,
  MATRIX_CELL_TRANSITIONS,
} from '../../server/state-machines.js';

describe('REQUEST_TRANSITIONS guard', () => {
  it('allows valid forward transitions (new → in_review)', () => {
    expect(
      validateTransition('request', REQUEST_TRANSITIONS, 'new', 'in_review'),
    ).toBe('in_review');
  });

  it('allows multi-hop forward transition (new → in_progress)', () => {
    expect(
      validateTransition('request', REQUEST_TRANSITIONS, 'new', 'in_progress'),
    ).toBe('in_progress');
  });

  it('allows in_review → completed', () => {
    expect(
      validateTransition('request', REQUEST_TRANSITIONS, 'in_review', 'completed'),
    ).toBe('completed');
  });

  it('rejects closed → new (the B24 bug)', () => {
    expect(() =>
      validateTransition('request', REQUEST_TRANSITIONS, 'closed', 'new'),
    ).toThrow(InvalidTransitionError);
  });

  it('rejects closed → in_progress (closed is terminal)', () => {
    expect(() =>
      validateTransition('request', REQUEST_TRANSITIONS, 'closed', 'in_progress'),
    ).toThrow(InvalidTransitionError);
  });

  it('rejects closed → completed (closed is terminal)', () => {
    expect(() =>
      validateTransition('request', REQUEST_TRANSITIONS, 'closed', 'completed'),
    ).toThrow(InvalidTransitionError);
  });

  it('InvalidTransitionError carries entity, from, to', () => {
    let err: InvalidTransitionError | undefined;
    try {
      validateTransition('request', REQUEST_TRANSITIONS, 'closed', 'new');
    } catch (e) {
      if (e instanceof InvalidTransitionError) err = e;
    }
    expect(err).toBeDefined();
    expect(err?.entity).toBe('request');
    expect(err?.from).toBe('closed');
    expect(err?.to).toBe('new');
  });
});

describe('MATRIX_CELL_TRANSITIONS guard', () => {
  it('allows valid forward transition (planned → keyword_validated)', () => {
    expect(
      validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, 'planned', 'keyword_validated'),
    ).toBe('keyword_validated');
  });

  it('allows sequential forward (draft → review)', () => {
    expect(
      validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, 'draft', 'review'),
    ).toBe('review');
  });

  it('allows review send-back edge (review → draft)', () => {
    expect(
      validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, 'review', 'draft'),
    ).toBe('draft');
  });

  it('rejects illegal skip from planned → published', () => {
    expect(() =>
      validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, 'planned', 'published'),
    ).toThrow(InvalidTransitionError);
  });

  it('rejects published → any (terminal)', () => {
    expect(() =>
      validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, 'published', 'draft'),
    ).toThrow(InvalidTransitionError);
  });

  it('allows admin shortcut: planned → review (send-samples)', () => {
    expect(
      validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, 'planned', 'review'),
    ).toBe('review');
  });

  it('allows admin shortcut: keyword_validated → approved (batch-approve)', () => {
    expect(
      validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, 'keyword_validated', 'approved'),
    ).toBe('approved');
  });

  it('rejects illegal skip from keyword_validated → published', () => {
    expect(() =>
      validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, 'keyword_validated', 'published'),
    ).toThrow(InvalidTransitionError);
  });
});
