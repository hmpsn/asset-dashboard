/**
 * Unit tests for the tracked-keyword lifecycle state machine
 * (server/state-machines.ts `TRACKED_KEYWORD_TRANSITIONS`).
 *
 * Closes the "keywords are the only status entity not state-machine-guarded" gap
 * (Keyword Hub Wave 4 / P3-3a). The legal edge set is DERIVED from the live action
 * switch in `applyKeywordCommandCenterActionInternal`:
 *   active → paused      (PAUSE_TRACKING)
 *   active → deprecated  (RETIRE, DECLINE-of-tracked)
 *   paused → deprecated  (RETIRE/DECLINE while paused)
 *   paused → active      (RESTORE)
 *   deprecated → active  (RESTORE — revive clears deprecatedAt/replacedBy)
 *   active|paused → replaced (reconcile-only lifecycle edge; replaced is terminal)
 */
import { describe, it, expect } from 'vitest';
import {
  validateTransition,
  InvalidTransitionError,
  TRACKED_KEYWORD_TRANSITIONS,
} from '../../server/state-machines.js';

const validate = (from: string, to: string) =>
  validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, from, to);

describe('TRACKED_KEYWORD_TRANSITIONS', () => {
  describe('legal edges (every transition the action switch + reconcile perform)', () => {
    it('active → paused (PAUSE_TRACKING)', () => {
      expect(validate('active', 'paused')).toBe('paused');
    });
    it('active → deprecated (RETIRE / DECLINE-of-tracked)', () => {
      expect(validate('active', 'deprecated')).toBe('deprecated');
    });
    it('active → replaced (reconcile replacement)', () => {
      expect(validate('active', 'replaced')).toBe('replaced');
    });
    it('paused → deprecated (RETIRE / DECLINE while paused)', () => {
      expect(validate('paused', 'deprecated')).toBe('deprecated');
    });
    it('paused → active (RESTORE)', () => {
      expect(validate('paused', 'active')).toBe('active');
    });
    it('paused → replaced (reconcile replacement)', () => {
      expect(validate('paused', 'replaced')).toBe('replaced');
    });
    it('deprecated → active (RESTORE — revive clears deprecatedAt/replacedBy)', () => {
      expect(validate('deprecated', 'active')).toBe('active');
    });
  });

  describe('illegal edges throw InvalidTransitionError', () => {
    it('deprecated → paused (cannot pause a retired keyword — must restore first)', () => {
      expect(() => validate('deprecated', 'paused')).toThrow(InvalidTransitionError);
    });
    it('deprecated → replaced (deprecated and replaced are not interconvertible)', () => {
      expect(() => validate('deprecated', 'replaced')).toThrow(InvalidTransitionError);
    });
    it('replaced → active (replaced is terminal)', () => {
      expect(() => validate('replaced', 'active')).toThrow(InvalidTransitionError);
    });
    it('replaced → deprecated (replaced is terminal)', () => {
      expect(() => validate('replaced', 'deprecated')).toThrow(InvalidTransitionError);
    });
    it('active → active (self-transition is never legal)', () => {
      expect(() => validate('active', 'active')).toThrow(InvalidTransitionError);
    });
    it('paused → paused (self-transition is never legal)', () => {
      expect(() => validate('paused', 'paused')).toThrow(InvalidTransitionError);
    });
  });

  describe('unknown source state throws', () => {
    it("'not_tracked' is not a machine state (TRACK is an insert, not a transition)", () => {
      expect(() => validate('not_tracked', 'active')).toThrow(InvalidTransitionError);
    });
  });

  describe('thrown error carries entity / from / to', () => {
    it('entity is tracked_keyword with the attempted from/to', () => {
      let caught: InvalidTransitionError | null = null;
      try {
        validate('deprecated', 'paused');
      } catch (e) {
        caught = e as InvalidTransitionError;
      }
      expect(caught).toBeInstanceOf(InvalidTransitionError);
      expect(caught!.entity).toBe('tracked_keyword');
      expect(caught!.from).toBe('deprecated');
      expect(caught!.to).toBe('paused');
    });
  });

  it('replaced is terminal (no outbound edges)', () => {
    expect(TRACKED_KEYWORD_TRANSITIONS.replaced).toEqual([]);
  });
});
