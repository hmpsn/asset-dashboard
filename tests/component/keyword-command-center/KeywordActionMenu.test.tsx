/**
 * Tests for KeywordActionMenu (P3-3c) — the lifecycle-aware per-row action affordance for
 * the Keyword Hub. Renders items from row.nextActions; Delete-permanently is a SEPARATED,
 * red, confirmed channel rendered ONLY when the client eligibility predicate is true.
 *
 * Four Laws: track/move/restore = teal, retire/decline = AMBER (remapped here from the
 * server's flag-OFF red so the KCC stays byte-identical), Delete = the ONLY red affordance.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeywordActionMenu } from '../../../src/components/keyword-command-center/KeywordActionMenu';
import { KEYWORD_COMMAND_CENTER_ACTIONS, KEYWORD_COMMAND_CENTER_STATUS } from '../../../shared/types/keyword-command-center';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../../shared/types/rank-tracking';
import type { KeywordCommandCenterRow, KeywordCommandCenterNextAction } from '../../../shared/types/keyword-command-center';

function makeRow(overrides: Partial<KeywordCommandCenterRow> = {}): KeywordCommandCenterRow {
  return {
    keyword: 'plumber austin',
    normalizedKeyword: 'plumber austin',
    lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED,
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: {},
    tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE, source: TRACKED_KEYWORD_SOURCE.MANUAL, pinned: false },
    nextActions: [],
    isProtected: false,
    ...overrides,
  };
}

const action = (over: Partial<KeywordCommandCenterNextAction> & Pick<KeywordCommandCenterNextAction, 'type' | 'label'>): KeywordCommandCenterNextAction => ({
  detail: 'detail',
  tone: 'teal',
  keyword: 'plumber austin',
  ...over,
});

const TRACKED_ACTIONS: KeywordCommandCenterNextAction[] = [
  action({ type: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING, label: 'Pause tracking', tone: 'amber' }),
  action({ type: KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE, label: 'Decline', tone: 'red' }),
  action({ type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE, label: 'Retire', tone: 'red' }),
];

const RESTORE_ONLY: KeywordCommandCenterNextAction[] = [
  action({ type: KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE, label: 'Restore', tone: 'teal' }),
];

describe('KeywordActionMenu', () => {
  it('a retired (strategy-provenance) row renders only Restore (no Pause/Retire/Decline, no Delete)', () => {
    // A retired keyword that came from the strategy loop (RECOMMENDATION) is ineligible for
    // hard delete — it must be restored, not deleted. Its only lifecycle action is Restore.
    const row = makeRow({
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.RETIRED,
      tracking: { status: TRACKED_KEYWORD_STATUS.DEPRECATED, source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION, pinned: false },
      nextActions: RESTORE_ONLY,
    });
    render(<KeywordActionMenu row={row} onAction={vi.fn()} onDeleteHard={vi.fn()} />);

    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^retire$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pause/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete permanently/i })).not.toBeInTheDocument();
  });

  it('a tracked MANUAL row renders Pause/Retire/Decline AND a separated Delete', () => {
    const row = makeRow({
      tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE, source: TRACKED_KEYWORD_SOURCE.MANUAL, pinned: false },
      nextActions: TRACKED_ACTIONS,
    });
    render(<KeywordActionMenu row={row} onAction={vi.fn()} onDeleteHard={vi.fn()} />);

    expect(screen.getByRole('button', { name: /pause tracking/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^retire$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete permanently/i })).toBeInTheDocument();
  });

  it('a tracked CLIENT_REQUESTED row renders Retire but NO Delete', () => {
    const row = makeRow({
      tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE, source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED, pinned: false },
      nextActions: TRACKED_ACTIONS,
    });
    render(<KeywordActionMenu row={row} onAction={vi.fn()} onDeleteHard={vi.fn()} />);

    expect(screen.getByRole('button', { name: /^retire$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete permanently/i })).not.toBeInTheDocument();
  });

  it('a pinned MANUAL row hides Delete (ineligible — retire is the only remove)', () => {
    const row = makeRow({
      tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE, source: TRACKED_KEYWORD_SOURCE.MANUAL, pinned: true },
      nextActions: TRACKED_ACTIONS,
    });
    render(<KeywordActionMenu row={row} onAction={vi.fn()} onDeleteHard={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /delete permanently/i })).not.toBeInTheDocument();
  });

  it('a gap-provenanced MANUAL row hides Delete (must be retired)', () => {
    const row = makeRow({
      tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE, source: TRACKED_KEYWORD_SOURCE.MANUAL, pinned: false, sourceGapKey: 'gap:plumber austin' },
      nextActions: TRACKED_ACTIONS,
    });
    render(<KeywordActionMenu row={row} onAction={vi.fn()} onDeleteHard={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /delete permanently/i })).not.toBeInTheDocument();
  });

  it('clicking a lifecycle action fires onAction with that action type', () => {
    const onAction = vi.fn();
    const row = makeRow({ nextActions: TRACKED_ACTIONS });
    render(<KeywordActionMenu row={row} onAction={onAction} onDeleteHard={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /pause tracking/i }));
    expect(onAction).toHaveBeenCalledWith(KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING, undefined);
  });

  it('clicking Delete opens the destructive ConfirmDialog and fires onDeleteHard ONLY after confirm', () => {
    const onDeleteHard = vi.fn();
    const row = makeRow({ nextActions: TRACKED_ACTIONS });
    render(<KeywordActionMenu row={row} onAction={vi.fn()} onDeleteHard={onDeleteHard} />);

    // Click the Delete IconButton (label includes the keyword) — opens the confirm dialog;
    // onDeleteHard NOT yet called.
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently: plumber austin' }));
    expect(onDeleteHard).not.toHaveBeenCalled();

    // The destructive confirm copy must mention rank history + irreversibility.
    expect(screen.getByText(/rank history/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();

    // Confirm (the dialog's confirm button has the exact label "Delete permanently") →
    // fires onDeleteHard with the keyword.
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(onDeleteHard).toHaveBeenCalledWith('plumber austin');
  });
});
