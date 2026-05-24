/**
 * Unit tests for server/state-machines.ts — transition guards for all entity state machines.
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
  BACKGROUND_JOB_TRANSITIONS,
  BRIEFING_DRAFT_TRANSITIONS,
} from '../../server/state-machines.js';

// ── validateTransition() core behavior ──

describe('validateTransition() core', () => {
  it('returns the target status on a valid transition', () => {
    const result = validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'pending', 'approved');
    expect(result).toBe('approved');
  });

  it('throws InvalidTransitionError on an invalid transition', () => {
    expect(() =>
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'pending', 'applied'),
    ).toThrow(InvalidTransitionError);
  });

  it('throws InvalidTransitionError when source state is unknown in the map', () => {
    expect(() =>
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'nonexistent' as never, 'pending'),
    ).toThrow(InvalidTransitionError);
  });

  it('throws when attempting a same-state no-op (self-transition not in any map)', () => {
    expect(() =>
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'pending', 'pending'),
    ).toThrow(InvalidTransitionError);
  });

  it('thrown error carries correct entity, from, and to properties', () => {
    let caught: InvalidTransitionError | null = null;
    try {
      validateTransition('work_order', WORK_ORDER_TRANSITIONS, 'completed', 'pending');
    } catch (e) {
      caught = e as InvalidTransitionError;
    }
    expect(caught).toBeInstanceOf(InvalidTransitionError);
    expect(caught!.entity).toBe('work_order');
    expect(caught!.from).toBe('completed');
    expect(caught!.to).toBe('pending');
  });

  it('error message includes entity name and both state values', () => {
    let caught: InvalidTransitionError | null = null;
    try {
      validateTransition('post', POST_STATUS_TRANSITIONS, 'approved', 'draft');
    } catch (e) {
      caught = e as InvalidTransitionError;
    }
    expect(caught!.message).toContain('post');
    expect(caught!.message).toContain('approved');
    expect(caught!.message).toContain('draft');
  });

  it('error name is InvalidTransitionError', () => {
    let caught: InvalidTransitionError | null = null;
    try {
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'applied', 'pending');
    } catch (e) {
      caught = e as InvalidTransitionError;
    }
    expect(caught!.name).toBe('InvalidTransitionError');
  });
});

// ── Approval Item transitions ──

describe('Approval Item transitions', () => {
  const validate = (from: string, to: string) =>
    validateTransition('approval_item', APPROVAL_ITEM_TRANSITIONS, from, to);

  describe('valid transitions', () => {
    it('pending → approved', () => {
      expect(validate('pending', 'approved')).toBe('approved');
    });

    it('pending → rejected', () => {
      expect(validate('pending', 'rejected')).toBe('rejected');
    });

    it('approved → pending (undo approval)', () => {
      expect(validate('approved', 'pending')).toBe('pending');
    });

    it('approved → applied', () => {
      expect(validate('approved', 'applied')).toBe('applied');
    });

    it('rejected → pending (undo rejection)', () => {
      expect(validate('rejected', 'pending')).toBe('pending');
    });
  });

  describe('invalid transitions', () => {
    it('pending → applied (skips approved)', () => {
      expect(() => validate('pending', 'applied')).toThrow(InvalidTransitionError);
    });

    it('rejected → approved', () => {
      expect(() => validate('rejected', 'approved')).toThrow(InvalidTransitionError);
    });

    it('rejected → applied', () => {
      expect(() => validate('rejected', 'applied')).toThrow(InvalidTransitionError);
    });

    it('applied → pending (terminal state)', () => {
      expect(() => validate('applied', 'pending')).toThrow(InvalidTransitionError);
    });

    it('applied → approved (terminal state)', () => {
      expect(() => validate('applied', 'approved')).toThrow(InvalidTransitionError);
    });

    it('applied → rejected (terminal state)', () => {
      expect(() => validate('applied', 'rejected')).toThrow(InvalidTransitionError);
    });
  });

  it('applied has an empty transition array (terminal)', () => {
    expect(APPROVAL_ITEM_TRANSITIONS['applied']).toEqual([]);
  });
});

// ── Content Request transitions ──

describe('Content Request transitions', () => {
  const validate = (from: string, to: string) =>
    validateTransition('content_request', CONTENT_REQUEST_TRANSITIONS, from, to);

  describe('happy path', () => {
    it('requested → brief_generated', () => {
      expect(validate('requested', 'brief_generated')).toBe('brief_generated');
    });

    it('brief_generated → client_review', () => {
      expect(validate('brief_generated', 'client_review')).toBe('client_review');
    });

    it('client_review → approved', () => {
      expect(validate('client_review', 'approved')).toBe('approved');
    });

    it('approved → in_progress', () => {
      expect(validate('approved', 'in_progress')).toBe('in_progress');
    });

    it('in_progress → delivered', () => {
      expect(validate('in_progress', 'delivered')).toBe('delivered');
    });

    it('delivered → published', () => {
      expect(validate('delivered', 'published')).toBe('published');
    });
  });

  describe('admin fast-track (skip intermediate steps)', () => {
    it('requested → in_progress', () => {
      expect(validate('requested', 'in_progress')).toBe('in_progress');
    });

    it('requested → delivered', () => {
      expect(validate('requested', 'delivered')).toBe('delivered');
    });

    it('requested → published', () => {
      expect(validate('requested', 'published')).toBe('published');
    });

    it('brief_generated → approved', () => {
      expect(validate('brief_generated', 'approved')).toBe('approved');
    });

    it('client_review → in_progress', () => {
      expect(validate('client_review', 'in_progress')).toBe('in_progress');
    });

    it('approved → delivered', () => {
      expect(validate('approved', 'delivered')).toBe('delivered');
    });

    it('approved → published', () => {
      expect(validate('approved', 'published')).toBe('published');
    });
  });

  describe('decline from any non-terminal state', () => {
    it('pending_payment → declined', () => {
      expect(validate('pending_payment', 'declined')).toBe('declined');
    });

    it('requested → declined', () => {
      expect(validate('requested', 'declined')).toBe('declined');
    });

    it('client_review → declined', () => {
      expect(validate('client_review', 'declined')).toBe('declined');
    });

    it('in_progress → declined', () => {
      expect(validate('in_progress', 'declined')).toBe('declined');
    });
  });

  describe('payment gate transitions', () => {
    it('pending_payment → requested (valid)', () => {
      expect(validate('pending_payment', 'requested')).toBe('requested');
    });

    it('pending_payment → in_progress (invalid — must go through requested first)', () => {
      expect(() => validate('pending_payment', 'in_progress')).toThrow(InvalidTransitionError);
    });

    it('pending_payment → brief_generated (invalid)', () => {
      expect(() => validate('pending_payment', 'brief_generated')).toThrow(InvalidTransitionError);
    });
  });

  describe('changes_requested sub-cycle', () => {
    it('client_review → changes_requested', () => {
      expect(validate('client_review', 'changes_requested')).toBe('changes_requested');
    });

    it('changes_requested → client_review (re-review)', () => {
      expect(validate('changes_requested', 'client_review')).toBe('client_review');
    });

    it('changes_requested → brief_generated (back to brief)', () => {
      expect(validate('changes_requested', 'brief_generated')).toBe('brief_generated');
    });

    it('changes_requested → approved (fast-track after changes)', () => {
      expect(validate('changes_requested', 'approved')).toBe('approved');
    });
  });

  describe('terminal states', () => {
    it('published → any state throws', () => {
      expect(() => validate('published', 'in_progress')).toThrow(InvalidTransitionError);
      expect(() => validate('published', 'delivered')).toThrow(InvalidTransitionError);
      expect(() => validate('published', 'declined')).toThrow(InvalidTransitionError);
    });

    it('declined → any state throws', () => {
      expect(() => validate('declined', 'requested')).toThrow(InvalidTransitionError);
      expect(() => validate('declined', 'in_progress')).toThrow(InvalidTransitionError);
      expect(() => validate('declined', 'published')).toThrow(InvalidTransitionError);
    });

    it('published has an empty transition array', () => {
      expect(CONTENT_REQUEST_TRANSITIONS['published']).toEqual([]);
    });

    it('declined has an empty transition array', () => {
      expect(CONTENT_REQUEST_TRANSITIONS['declined']).toEqual([]);
    });
  });

  describe('backward movement blocked', () => {
    it('delivered → requested throws', () => {
      expect(() => validate('delivered', 'requested')).toThrow(InvalidTransitionError);
    });

    it('published → in_progress throws', () => {
      expect(() => validate('published', 'in_progress')).toThrow(InvalidTransitionError);
    });

    it('in_progress → requested throws', () => {
      expect(() => validate('in_progress', 'requested')).toThrow(InvalidTransitionError);
    });

    it('approved → client_review throws', () => {
      expect(() => validate('approved', 'client_review')).toThrow(InvalidTransitionError);
    });

    it('approved → requested throws', () => {
      expect(() => validate('approved', 'requested')).toThrow(InvalidTransitionError);
    });
  });
});

// ── Generated Post transitions ──

describe('Generated Post transitions', () => {
  const validate = (from: string, to: string) =>
    validateTransition('post', POST_STATUS_TRANSITIONS, from, to);

  describe('valid transitions', () => {
    it('generating → draft', () => {
      expect(validate('generating', 'draft')).toBe('draft');
    });

    it('draft → review', () => {
      expect(validate('draft', 'review')).toBe('review');
    });

    it('review → approved', () => {
      expect(validate('review', 'approved')).toBe('approved');
    });

    it('review → draft (send back for edits)', () => {
      expect(validate('review', 'draft')).toBe('draft');
    });
  });

  describe('invalid transitions', () => {
    it('generating → approved (skip draft and review)', () => {
      expect(() => validate('generating', 'approved')).toThrow(InvalidTransitionError);
    });

    it('generating → review (must go through draft)', () => {
      expect(() => validate('generating', 'review')).toThrow(InvalidTransitionError);
    });

    it('draft → approved (skip review step)', () => {
      expect(() => validate('draft', 'approved')).toThrow(InvalidTransitionError);
    });

    it('draft → generating (backward not allowed)', () => {
      expect(() => validate('draft', 'generating')).toThrow(InvalidTransitionError);
    });

    it('approved → review (terminal state)', () => {
      expect(() => validate('approved', 'review')).toThrow(InvalidTransitionError);
    });

    it('approved → draft (terminal state)', () => {
      expect(() => validate('approved', 'draft')).toThrow(InvalidTransitionError);
    });

    it('approved → generating (terminal state)', () => {
      expect(() => validate('approved', 'generating')).toThrow(InvalidTransitionError);
    });
  });

  it('approved has an empty transition array (terminal)', () => {
    expect(POST_STATUS_TRANSITIONS['approved']).toEqual([]);
  });
});

// ── Work Order transitions ──

describe('Work Order transitions', () => {
  const validate = (from: string, to: string) =>
    validateTransition('work_order', WORK_ORDER_TRANSITIONS, from, to);

  describe('valid transitions', () => {
    it('pending → in_progress', () => {
      expect(validate('pending', 'in_progress')).toBe('in_progress');
    });

    it('pending → cancelled', () => {
      expect(validate('pending', 'cancelled')).toBe('cancelled');
    });

    it('in_progress → completed', () => {
      expect(validate('in_progress', 'completed')).toBe('completed');
    });

    it('in_progress → cancelled', () => {
      expect(validate('in_progress', 'cancelled')).toBe('cancelled');
    });
  });

  describe('invalid transitions', () => {
    it('pending → completed (skips in_progress)', () => {
      expect(() => validate('pending', 'completed')).toThrow(InvalidTransitionError);
    });

    it('completed → pending (cannot reopen)', () => {
      expect(() => validate('completed', 'pending')).toThrow(InvalidTransitionError);
    });

    it('completed → in_progress (terminal state)', () => {
      expect(() => validate('completed', 'in_progress')).toThrow(InvalidTransitionError);
    });

    it('completed → cancelled (terminal state)', () => {
      expect(() => validate('completed', 'cancelled')).toThrow(InvalidTransitionError);
    });

    it('cancelled → pending (terminal state)', () => {
      expect(() => validate('cancelled', 'pending')).toThrow(InvalidTransitionError);
    });

    it('cancelled → in_progress (terminal state)', () => {
      expect(() => validate('cancelled', 'in_progress')).toThrow(InvalidTransitionError);
    });

    it('cancelled → completed (terminal state)', () => {
      expect(() => validate('cancelled', 'completed')).toThrow(InvalidTransitionError);
    });
  });

  it('completed has an empty transition array (terminal)', () => {
    expect(WORK_ORDER_TRANSITIONS['completed']).toEqual([]);
  });

  it('cancelled has an empty transition array (terminal)', () => {
    expect(WORK_ORDER_TRANSITIONS['cancelled']).toEqual([]);
  });
});

// ── Content Subscription transitions ──

describe('Content Subscription transitions', () => {
  const validate = (from: string, to: string) =>
    validateTransition('content_sub', CONTENT_SUB_TRANSITIONS, from, to);

  describe('valid transitions', () => {
    it('pending → active (activation)', () => {
      expect(validate('pending', 'active')).toBe('active');
    });

    it('active → paused', () => {
      expect(validate('active', 'paused')).toBe('paused');
    });

    it('active → pending', () => {
      expect(validate('active', 'pending')).toBe('pending');
    });

    it('active → past_due', () => {
      expect(validate('active', 'past_due')).toBe('past_due');
    });

    it('active → cancelled', () => {
      expect(validate('active', 'cancelled')).toBe('cancelled');
    });

    it('paused → active (resume)', () => {
      expect(validate('paused', 'active')).toBe('active');
    });

    it('paused → pending', () => {
      expect(validate('paused', 'pending')).toBe('pending');
    });

    it('paused → cancelled', () => {
      expect(validate('paused', 'cancelled')).toBe('cancelled');
    });

    it('past_due → active (payment recovered)', () => {
      expect(validate('past_due', 'active')).toBe('active');
    });

    it('past_due → pending', () => {
      expect(validate('past_due', 'pending')).toBe('pending');
    });

    it('past_due → cancelled', () => {
      expect(validate('past_due', 'cancelled')).toBe('cancelled');
    });
  });

  describe('invalid transitions', () => {
    it('pending → paused (must activate first)', () => {
      expect(() => validate('pending', 'paused')).toThrow(InvalidTransitionError);
    });

    it('pending → past_due (must activate first)', () => {
      expect(() => validate('pending', 'past_due')).toThrow(InvalidTransitionError);
    });

    it('cancelled → active (terminal state)', () => {
      expect(() => validate('cancelled', 'active')).toThrow(InvalidTransitionError);
    });

    it('cancelled → paused (terminal state)', () => {
      expect(() => validate('cancelled', 'paused')).toThrow(InvalidTransitionError);
    });

    it('cancelled → past_due (terminal state)', () => {
      expect(() => validate('cancelled', 'past_due')).toThrow(InvalidTransitionError);
    });

    it('cancelled → pending (terminal state)', () => {
      expect(() => validate('cancelled', 'pending')).toThrow(InvalidTransitionError);
    });

    it('paused → past_due (not a valid paused exit)', () => {
      expect(() => validate('paused', 'past_due')).toThrow(InvalidTransitionError);
    });

    it('past_due → paused (not a valid recovery path)', () => {
      expect(() => validate('past_due', 'paused')).toThrow(InvalidTransitionError);
    });
  });

  it('cancelled has an empty transition array (terminal)', () => {
    expect(CONTENT_SUB_TRANSITIONS['cancelled']).toEqual([]);
  });
});

// ── Client Action transitions ──

describe('Client Action transitions', () => {
  const validate = (from: string, to: string) =>
    validateTransition('client_action', CLIENT_ACTION_TRANSITIONS, from, to);

  describe('valid transitions', () => {
    it('pending → approved', () => {
      expect(validate('pending', 'approved')).toBe('approved');
    });

    it('pending → changes_requested', () => {
      expect(validate('pending', 'changes_requested')).toBe('changes_requested');
    });

    it('pending → completed', () => {
      expect(validate('pending', 'completed')).toBe('completed');
    });

    it('approved → completed', () => {
      expect(validate('approved', 'completed')).toBe('completed');
    });

    it('changes_requested → pending', () => {
      expect(validate('changes_requested', 'pending')).toBe('pending');
    });

    it('completed → archived', () => {
      expect(validate('completed', 'archived')).toBe('archived');
    });
  });

  describe('invalid transitions', () => {
    it('approved → pending (must route through changes_requested when reopening)', () => {
      expect(() => validate('approved', 'pending')).toThrow(InvalidTransitionError);
    });

    it('changes_requested → approved (must return to pending first)', () => {
      expect(() => validate('changes_requested', 'approved')).toThrow(InvalidTransitionError);
    });

    it('completed → pending (terminal except archive)', () => {
      expect(() => validate('completed', 'pending')).toThrow(InvalidTransitionError);
    });

    it('archived → pending (terminal)', () => {
      expect(() => validate('archived', 'pending')).toThrow(InvalidTransitionError);
    });

    it('archived → completed (terminal)', () => {
      expect(() => validate('archived', 'completed')).toThrow(InvalidTransitionError);
    });
  });

  it('archived has an empty transition array (terminal)', () => {
    expect(CLIENT_ACTION_TRANSITIONS['archived']).toEqual([]);
  });
});

// ── Briefing Draft transitions ──

describe('Briefing Draft transitions', () => {
  const validate = (from: string, to: string) =>
    validateTransition('briefing_draft', BRIEFING_DRAFT_TRANSITIONS, from, to);

  describe('valid transitions', () => {
    it('draft → approved', () => {
      expect(validate('draft', 'approved')).toBe('approved');
    });

    it('draft → published', () => {
      expect(validate('draft', 'published')).toBe('published');
    });

    it('draft → skipped', () => {
      expect(validate('draft', 'skipped')).toBe('skipped');
    });

    it('approved → published', () => {
      expect(validate('approved', 'published')).toBe('published');
    });

    it('approved → skipped', () => {
      expect(validate('approved', 'skipped')).toBe('skipped');
    });

    it('approved → draft', () => {
      expect(validate('approved', 'draft')).toBe('draft');
    });
  });

  describe('invalid transitions', () => {
    it('draft → draft (no self transition)', () => {
      expect(() => validate('draft', 'draft')).toThrow(InvalidTransitionError);
    });

    it('published → approved (terminal)', () => {
      expect(() => validate('published', 'approved')).toThrow(InvalidTransitionError);
    });

    it('published → draft (terminal)', () => {
      expect(() => validate('published', 'draft')).toThrow(InvalidTransitionError);
    });

    it('skipped → draft (terminal)', () => {
      expect(() => validate('skipped', 'draft')).toThrow(InvalidTransitionError);
    });

    it('skipped → approved (terminal)', () => {
      expect(() => validate('skipped', 'approved')).toThrow(InvalidTransitionError);
    });
  });

  it('published and skipped are terminal arrays', () => {
    expect(BRIEFING_DRAFT_TRANSITIONS['published']).toEqual([]);
    expect(BRIEFING_DRAFT_TRANSITIONS['skipped']).toEqual([]);
  });
});

// ── Background Job transitions ──

describe('Background Job transitions', () => {
  const validate = (from: string, to: string) =>
    validateTransition('background_job', BACKGROUND_JOB_TRANSITIONS, from, to);

  describe('valid transitions', () => {
    it('pending → running', () => {
      expect(validate('pending', 'running')).toBe('running');
    });

    it('pending → done', () => {
      expect(validate('pending', 'done')).toBe('done');
    });

    it('pending → error', () => {
      expect(validate('pending', 'error')).toBe('error');
    });

    it('pending → cancelled', () => {
      expect(validate('pending', 'cancelled')).toBe('cancelled');
    });

    it('running → done', () => {
      expect(validate('running', 'done')).toBe('done');
    });

    it('running → error', () => {
      expect(validate('running', 'error')).toBe('error');
    });

    it('running → cancelled', () => {
      expect(validate('running', 'cancelled')).toBe('cancelled');
    });
  });

  describe('invalid transitions', () => {
    it('done → running (terminal)', () => {
      expect(() => validate('done', 'running')).toThrow(InvalidTransitionError);
    });

    it('done → pending (terminal)', () => {
      expect(() => validate('done', 'pending')).toThrow(InvalidTransitionError);
    });

    it('done → error (terminal)', () => {
      expect(() => validate('done', 'error')).toThrow(InvalidTransitionError);
    });

    it('done → cancelled (terminal)', () => {
      expect(() => validate('done', 'cancelled')).toThrow(InvalidTransitionError);
    });

    it('error → running (terminal)', () => {
      expect(() => validate('error', 'running')).toThrow(InvalidTransitionError);
    });

    it('error → pending (terminal)', () => {
      expect(() => validate('error', 'pending')).toThrow(InvalidTransitionError);
    });

    it('error → done (terminal)', () => {
      expect(() => validate('error', 'done')).toThrow(InvalidTransitionError);
    });

    it('error → cancelled (terminal)', () => {
      expect(() => validate('error', 'cancelled')).toThrow(InvalidTransitionError);
    });

    it('cancelled → running (terminal)', () => {
      expect(() => validate('cancelled', 'running')).toThrow(InvalidTransitionError);
    });

    it('cancelled → done (terminal)', () => {
      expect(() => validate('cancelled', 'done')).toThrow(InvalidTransitionError);
    });

    it('cancelled → error (terminal)', () => {
      expect(() => validate('cancelled', 'error')).toThrow(InvalidTransitionError);
    });

    it('running → pending (no rollback)', () => {
      expect(() => validate('running', 'pending')).toThrow(InvalidTransitionError);
    });
  });

  it('all terminal states have empty transition arrays', () => {
    expect(BACKGROUND_JOB_TRANSITIONS['done']).toEqual([]);
    expect(BACKGROUND_JOB_TRANSITIONS['error']).toEqual([]);
    expect(BACKGROUND_JOB_TRANSITIONS['cancelled']).toEqual([]);
  });
});

// ── Generated Post — additional coverage gaps ──

describe('Generated Post transitions — additional coverage', () => {
  const validate = (from: string, to: string) =>
    validateTransition('post', POST_STATUS_TRANSITIONS, from, to);

  it('generating → error (generation failure path)', () => {
    expect(validate('generating', 'error')).toBe('error');
  });

  it('error → draft (recovery after error)', () => {
    expect(validate('error', 'draft')).toBe('draft');
  });

  it('error → generating (no rollback to generating)', () => {
    expect(() => validate('error', 'generating')).toThrow(InvalidTransitionError);
  });

  it('error → review (cannot skip draft after error)', () => {
    expect(() => validate('error', 'review')).toThrow(InvalidTransitionError);
  });

  it('error → approved (cannot skip to terminal after error)', () => {
    expect(() => validate('error', 'approved')).toThrow(InvalidTransitionError);
  });
});

// ── Client Action — additional coverage gaps ──

describe('Client Action transitions — additional coverage', () => {
  const validate = (from: string, to: string) =>
    validateTransition('client_action', CLIENT_ACTION_TRANSITIONS, from, to);

  it('pending → archived (direct archive path)', () => {
    expect(validate('pending', 'archived')).toBe('archived');
  });

  it('approved → archived', () => {
    expect(validate('approved', 'archived')).toBe('archived');
  });

  it('changes_requested → completed', () => {
    expect(validate('changes_requested', 'completed')).toBe('completed');
  });

  it('changes_requested → archived', () => {
    expect(validate('changes_requested', 'archived')).toBe('archived');
  });

  it('approved → pending (not allowed — must go through changes_requested)', () => {
    expect(() => validate('approved', 'pending')).toThrow(InvalidTransitionError);
  });

  it('completed → approved (terminal except archive)', () => {
    expect(() => validate('completed', 'approved')).toThrow(InvalidTransitionError);
  });

  it('completed → changes_requested (terminal except archive)', () => {
    expect(() => validate('completed', 'changes_requested')).toThrow(InvalidTransitionError);
  });

  it('archived → changes_requested (terminal)', () => {
    expect(() => validate('archived', 'changes_requested')).toThrow(InvalidTransitionError);
  });

  it('archived → approved (terminal)', () => {
    expect(() => validate('archived', 'approved')).toThrow(InvalidTransitionError);
  });
});

// ── Content Request — additional coverage gaps ──

describe('Content Request transitions — additional coverage', () => {
  const validate = (from: string, to: string) =>
    validateTransition('content_request', CONTENT_REQUEST_TRANSITIONS, from, to);

  it('in_progress → post_review', () => {
    expect(validate('in_progress', 'post_review')).toBe('post_review');
  });

  it('post_review → changes_requested', () => {
    expect(validate('post_review', 'changes_requested')).toBe('changes_requested');
  });

  it('post_review → delivered', () => {
    expect(validate('post_review', 'delivered')).toBe('delivered');
  });

  it('post_review → published', () => {
    expect(validate('post_review', 'published')).toBe('published');
  });

  it('post_review → declined', () => {
    expect(validate('post_review', 'declined')).toBe('declined');
  });

  it('post_review → requested (backward movement blocked)', () => {
    expect(() => validate('post_review', 'requested')).toThrow(InvalidTransitionError);
  });

  it('post_review → in_progress (not a valid post_review exit)', () => {
    expect(() => validate('post_review', 'in_progress')).toThrow(InvalidTransitionError);
  });

  it('changes_requested → in_progress', () => {
    expect(validate('changes_requested', 'in_progress')).toBe('in_progress');
  });

  it('changes_requested → post_review', () => {
    expect(validate('changes_requested', 'post_review')).toBe('post_review');
  });

  it('changes_requested → delivered', () => {
    expect(validate('changes_requested', 'delivered')).toBe('delivered');
  });

  it('changes_requested → published', () => {
    expect(validate('changes_requested', 'published')).toBe('published');
  });

  it('delivered → declined (not an allowed exit from delivered)', () => {
    expect(() => validate('delivered', 'declined')).toThrow(InvalidTransitionError);
  });

  it('delivered → in_progress (backward movement blocked)', () => {
    expect(() => validate('delivered', 'in_progress')).toThrow(InvalidTransitionError);
  });
});

// ── InvalidTransitionError — instanceof and Error chain ──

describe('InvalidTransitionError — class hierarchy and properties', () => {
  it('is instanceof Error', () => {
    let caught: unknown;
    try {
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'applied', 'pending');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it('is instanceof InvalidTransitionError', () => {
    let caught: unknown;
    try {
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'applied', 'pending');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidTransitionError);
  });

  it('carries the correct entity name', () => {
    let caught: InvalidTransitionError | null = null;
    try {
      validateTransition('my_entity', APPROVAL_ITEM_TRANSITIONS, 'applied', 'pending');
    } catch (e) {
      caught = e as InvalidTransitionError;
    }
    expect(caught!.entity).toBe('my_entity');
  });

  it('carries the correct from value', () => {
    let caught: InvalidTransitionError | null = null;
    try {
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'applied', 'pending');
    } catch (e) {
      caught = e as InvalidTransitionError;
    }
    expect(caught!.from).toBe('applied');
  });

  it('carries the correct to value', () => {
    let caught: InvalidTransitionError | null = null;
    try {
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'applied', 'pending');
    } catch (e) {
      caught = e as InvalidTransitionError;
    }
    expect(caught!.to).toBe('pending');
  });

  it('message format: "Invalid <entity> transition: \'<from>\' → \'<to>\'"', () => {
    let caught: InvalidTransitionError | null = null;
    try {
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'applied', 'pending');
    } catch (e) {
      caught = e as InvalidTransitionError;
    }
    expect(caught!.message).toBe("Invalid approval transition: 'applied' → 'pending'");
  });

  it('unknown from state: entity, from, to are all set on the error', () => {
    let caught: InvalidTransitionError | null = null;
    try {
      validateTransition('approval', APPROVAL_ITEM_TRANSITIONS, 'ghost_state' as never, 'pending');
    } catch (e) {
      caught = e as InvalidTransitionError;
    }
    expect(caught!.entity).toBe('approval');
    expect(caught!.from).toBe('ghost_state');
    expect(caught!.to).toBe('pending');
  });
});

// ── Unknown `from` state — silent-failure guard ──

describe('unknown from state throws across all maps', () => {
  it('CONTENT_REQUEST_TRANSITIONS unknown from state throws', () => {
    expect(() =>
      validateTransition('cr', CONTENT_REQUEST_TRANSITIONS, 'unknown' as never, 'requested'),
    ).toThrow(InvalidTransitionError);
  });

  it('POST_STATUS_TRANSITIONS unknown from state throws', () => {
    expect(() =>
      validateTransition('post', POST_STATUS_TRANSITIONS, 'nonexistent' as never, 'draft'),
    ).toThrow(InvalidTransitionError);
  });

  it('WORK_ORDER_TRANSITIONS unknown from state throws', () => {
    expect(() =>
      validateTransition('wo', WORK_ORDER_TRANSITIONS, 'bogus' as never, 'completed'),
    ).toThrow(InvalidTransitionError);
  });

  it('CONTENT_SUB_TRANSITIONS unknown from state throws', () => {
    expect(() =>
      validateTransition('sub', CONTENT_SUB_TRANSITIONS, 'mystery' as never, 'active'),
    ).toThrow(InvalidTransitionError);
  });

  it('CLIENT_ACTION_TRANSITIONS unknown from state throws', () => {
    expect(() =>
      validateTransition('action', CLIENT_ACTION_TRANSITIONS, 'invented' as never, 'pending'),
    ).toThrow(InvalidTransitionError);
  });

  it('BRIEFING_DRAFT_TRANSITIONS unknown from state throws', () => {
    expect(() =>
      validateTransition('briefing', BRIEFING_DRAFT_TRANSITIONS, 'typo_state' as never, 'draft'),
    ).toThrow(InvalidTransitionError);
  });

  it('BACKGROUND_JOB_TRANSITIONS unknown from state throws', () => {
    expect(() =>
      validateTransition('job', BACKGROUND_JOB_TRANSITIONS, 'stale_state' as never, 'running'),
    ).toThrow(InvalidTransitionError);
  });
});

// ── Return value chaining contract ──

describe('validateTransition return value contract', () => {
  it('returns the to value (not from, not void)', () => {
    const result = validateTransition('post', POST_STATUS_TRANSITIONS, 'draft', 'review');
    expect(result).toBe('review');
    expect(result).not.toBe('draft');
  });

  it('returned value is suitable for direct DB assignment', () => {
    // Simulates: const next = validateTransition(...); stmt.run({ status: next })
    const next = validateTransition('work_order', WORK_ORDER_TRANSITIONS, 'pending', 'in_progress');
    const record = { status: next };
    expect(record.status).toBe('in_progress');
  });

  it('returned value equals the to parameter for all maps', () => {
    const pairs: Array<[Record<string, readonly string[]>, string, string]> = [
      [APPROVAL_ITEM_TRANSITIONS, 'pending', 'rejected'],
      [CONTENT_REQUEST_TRANSITIONS, 'brief_generated', 'in_progress'],
      [POST_STATUS_TRANSITIONS, 'review', 'approved'],
      [WORK_ORDER_TRANSITIONS, 'in_progress', 'completed'],
      [CONTENT_SUB_TRANSITIONS, 'paused', 'active'],
      [CLIENT_ACTION_TRANSITIONS, 'approved', 'completed'],
      [BRIEFING_DRAFT_TRANSITIONS, 'approved', 'published'],
      [BACKGROUND_JOB_TRANSITIONS, 'running', 'done'],
    ];
    for (const [map, from, to] of pairs) {
      expect(validateTransition('entity', map, from, to)).toBe(to);
    }
  });
});
