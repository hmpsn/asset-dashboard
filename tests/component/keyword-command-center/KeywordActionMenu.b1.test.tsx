/**
 * B1 regression tests — protected-keyword force bypass fix.
 *
 * Before this fix, clicking a lifecycle button with `disabledReason` set would
 * SILENTLY call onAction(type, { force: true }) in one click, bypassing the
 * protection without any user confirmation.
 *
 * After the fix:
 *   - Protected action → opens ConfirmDialog showing the disabledReason text.
 *   - Confirm → dispatches onAction with { force: true }.
 *   - Cancel → dispatches nothing.
 *   - Unprotected action → dispatches immediately (no dialog), behavior unchanged.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeywordActionMenu } from '../../../src/components/keyword-command-center/KeywordActionMenu';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_STATUS,
} from '../../../shared/types/keyword-command-center';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../../shared/types/rank-tracking';
import type {
  KeywordCommandCenterRow,
  KeywordCommandCenterNextAction,
} from '../../../shared/types/keyword-command-center';

function makeRow(overrides: Partial<KeywordCommandCenterRow> = {}): KeywordCommandCenterRow {
  return {
    keyword: 'plumber austin',
    normalizedKeyword: 'plumber austin',
    lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED,
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: {},
    tracking: {
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED,
      pinned: false,
    },
    nextActions: [],
    isProtected: true,
    ...overrides,
  };
}

const makeAction = (
  over: Partial<KeywordCommandCenterNextAction> & Pick<KeywordCommandCenterNextAction, 'type' | 'label'>,
): KeywordCommandCenterNextAction => ({
  detail: 'detail',
  tone: 'teal',
  keyword: 'plumber austin',
  ...over,
});

describe('KeywordActionMenu — B1: protected action confirm gate', () => {
  it('clicking a protected action opens ConfirmDialog with the disabledReason text; onAction NOT called yet', () => {
    const onAction = vi.fn();
    const row = makeRow({
      nextActions: [
        makeAction({
          type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
          label: 'Retire',
          disabledReason: 'This keyword is client-requested. Remove it through the Decisions inbox instead.',
        }),
      ],
    });
    render(<KeywordActionMenu row={row} onAction={onAction} onDeleteHard={vi.fn()} />);

    // Click the lifecycle button — it is NOT disabled (disabledReason ≠ disabled)
    fireEvent.click(screen.getByRole('button', { name: /^retire$/i }));

    // ConfirmDialog renders, showing the disabledReason message
    expect(screen.getByText(/client-requested/i)).toBeInTheDocument();

    // onAction must NOT have fired yet
    expect(onAction).not.toHaveBeenCalled();
  });

  it('Confirm on the protected-action dialog dispatches onAction with { force: true }', () => {
    const onAction = vi.fn();
    const row = makeRow({
      nextActions: [
        makeAction({
          type: KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
          label: 'Decline',
          disabledReason: 'This keyword is pinned and cannot be declined without forcing.',
        }),
      ],
    });
    render(<KeywordActionMenu row={row} onAction={onAction} onDeleteHard={vi.fn()} />);

    // Open the dialog
    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));

    // Click the Confirm button inside the dialog
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith(
      KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
      { force: true },
    );
  });

  it('Cancel on the protected-action dialog dispatches nothing', () => {
    const onAction = vi.fn();
    const row = makeRow({
      nextActions: [
        makeAction({
          type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
          label: 'Retire',
          disabledReason: 'Protected keyword.',
        }),
      ],
    });
    render(<KeywordActionMenu row={row} onAction={onAction} onDeleteHard={vi.fn()} />);

    // Open the dialog
    fireEvent.click(screen.getByRole('button', { name: /^retire$/i }));

    // Click Cancel
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onAction).not.toHaveBeenCalled();

    // Dialog is dismissed — the disabledReason text should no longer be visible
    expect(screen.queryByText(/protected keyword/i)).not.toBeInTheDocument();
  });

  it('unprotected action dispatches immediately (no dialog)', () => {
    const onAction = vi.fn();
    const row = makeRow({
      isProtected: false,
      tracking: {
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
        source: TRACKED_KEYWORD_SOURCE.MANUAL,
        pinned: false,
      },
      nextActions: [
        makeAction({
          type: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
          label: 'Pause tracking',
          // no disabledReason → not protected
        }),
      ],
    });
    render(<KeywordActionMenu row={row} onAction={onAction} onDeleteHard={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /pause tracking/i }));

    // Dispatch fires immediately — no dialog shown, no delay
    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith(
      KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      undefined,
    );

    // No dialog/confirmation UI rendered
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('multiple protected actions each get their own dialog on click (only one open at a time)', () => {
    const onAction = vi.fn();
    const row = makeRow({
      nextActions: [
        makeAction({
          type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
          label: 'Retire',
          disabledReason: 'Reason for retire.',
        }),
        makeAction({
          type: KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
          label: 'Decline',
          disabledReason: 'Reason for decline.',
        }),
      ],
    });
    render(<KeywordActionMenu row={row} onAction={onAction} onDeleteHard={vi.fn()} />);

    // Click Retire → its disabledReason shown
    fireEvent.click(screen.getByRole('button', { name: /^retire$/i }));
    expect(screen.getByText('Reason for retire.')).toBeInTheDocument();
    expect(screen.queryByText('Reason for decline.')).not.toBeInTheDocument();
  });
});
