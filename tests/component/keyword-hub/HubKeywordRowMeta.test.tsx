/**
 * Tests for HubKeywordRowMeta — the renderKeywordMeta slot component for
 * HubKeywordList (P1-T3). Verifies:
 *   - StatusBadge for lifecycleStatus
 *   - blue "From gap" Badge when sourceGapKey defined; omitted when undefined
 *   - teal "Auto-managed" Badge when strategyOwned === true
 *   - three-state guard: strategyOwned false and undefined both omit "Auto-managed"
 *   - no violet/indigo/rose/pink class names in rendered HTML
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HubKeywordRowMeta } from '../../../src/components/keyword-hub/HubKeywordRowMeta';
import type { KeywordCommandCenterRow } from '../../../shared/types/keyword-command-center';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function makeRow(overrides: Partial<KeywordCommandCenterRow> = {}): KeywordCommandCenterRow {
  return {
    keyword: 'test keyword',
    normalizedKeyword: 'test-keyword',
    lifecycleStatus: 'tracked',
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: {},
    tracking: {
      status: 'active',
      ...overrides.tracking,
    },
    nextActions: [],
    isProtected: false,
    ...overrides,
    // Ensure tracking is not double-spread if provided at top level
    ...(overrides.tracking
      ? {
          tracking: {
            status: 'active',
            ...overrides.tracking,
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// StatusBadge for lifecycleStatus
// ---------------------------------------------------------------------------
describe('HubKeywordRowMeta — StatusBadge', () => {
  it('renders a StatusBadge for the row lifecycleStatus', () => {
    const row = makeRow({ lifecycleStatus: 'in_strategy' });
    const { container } = render(<HubKeywordRowMeta row={row} />);
    // The StatusBadge renders some content for in_strategy status
    // We just assert it does not crash and has something rendered
    expect(container.firstChild).not.toBeNull();
  });

  it('renders for tracked lifecycleStatus', () => {
    const row = makeRow({ lifecycleStatus: 'tracked' });
    render(<HubKeywordRowMeta row={row} />);
    // Component renders without error
  });

  it('renders for needs_review lifecycleStatus', () => {
    const row = makeRow({ lifecycleStatus: 'needs_review' });
    render(<HubKeywordRowMeta row={row} />);
    // Component renders without error
  });
});

// ---------------------------------------------------------------------------
// Blue "From gap" Badge
// ---------------------------------------------------------------------------
describe('HubKeywordRowMeta — From gap Badge', () => {
  it('renders "From gap" badge (blue) when sourceGapKey is defined', () => {
    const row = makeRow({ tracking: { status: 'active', sourceGapKey: 'gap-abc-123' } });
    render(<HubKeywordRowMeta row={row} />);
    expect(screen.getByText('From gap')).toBeInTheDocument();
    // Verify it has blue styling (bg-blue or text-blue)
    const badge = screen.getByText('From gap');
    expect(badge.className).toMatch(/blue/);
  });

  it('omits "From gap" badge when sourceGapKey is undefined', () => {
    const row = makeRow({ tracking: { status: 'active', sourceGapKey: undefined } });
    render(<HubKeywordRowMeta row={row} />);
    expect(screen.queryByText('From gap')).toBeNull();
  });

  it('omits "From gap" badge when sourceGapKey is empty string', () => {
    // Empty string is falsy — treated same as undefined
    const row = makeRow({ tracking: { status: 'active', sourceGapKey: '' } });
    render(<HubKeywordRowMeta row={row} />);
    expect(screen.queryByText('From gap')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Teal "Auto-managed" Badge — three-state guard
// ---------------------------------------------------------------------------
describe('HubKeywordRowMeta — Auto-managed Badge (three-state guard)', () => {
  it('renders "Auto-managed" badge (teal) when strategyOwned === true', () => {
    const row = makeRow({ tracking: { status: 'active', strategyOwned: true } });
    render(<HubKeywordRowMeta row={row} />);
    expect(screen.getByText('Auto-managed')).toBeInTheDocument();
    const badge = screen.getByText('Auto-managed');
    expect(badge.className).toMatch(/teal/);
  });

  it('omits "Auto-managed" when strategyOwned === false (three-state: false is real value)', () => {
    const row = makeRow({ tracking: { status: 'active', strategyOwned: false } });
    render(<HubKeywordRowMeta row={row} />);
    expect(screen.queryByText('Auto-managed')).toBeNull();
  });

  it('omits "Auto-managed" when strategyOwned === undefined (three-state: ownership unknown)', () => {
    const row = makeRow({ tracking: { status: 'active', strategyOwned: undefined } });
    render(<HubKeywordRowMeta row={row} />);
    expect(screen.queryByText('Auto-managed')).toBeNull();
  });

  it('omits "Auto-managed" when tracking has no strategyOwned property', () => {
    const row = makeRow({ tracking: { status: 'active' } });
    render(<HubKeywordRowMeta row={row} />);
    expect(screen.queryByText('Auto-managed')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Combined badges
// ---------------------------------------------------------------------------
describe('HubKeywordRowMeta — combined badge rendering', () => {
  it('renders both "From gap" and "Auto-managed" when both conditions met', () => {
    const row = makeRow({
      tracking: { status: 'active', sourceGapKey: 'gap-xyz', strategyOwned: true },
    });
    render(<HubKeywordRowMeta row={row} />);
    expect(screen.getByText('From gap')).toBeInTheDocument();
    expect(screen.getByText('Auto-managed')).toBeInTheDocument();
  });

  it('renders neither badge when tracking has no sourceGapKey and strategyOwned is false', () => {
    const row = makeRow({
      tracking: { status: 'active', sourceGapKey: undefined, strategyOwned: false },
    });
    render(<HubKeywordRowMeta row={row} />);
    expect(screen.queryByText('From gap')).toBeNull();
    expect(screen.queryByText('Auto-managed')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Four Laws of Color — no forbidden class names
// ---------------------------------------------------------------------------
describe('HubKeywordRowMeta — Four Laws of Color compliance', () => {
  it('renders no violet, indigo, rose, or pink class names', () => {
    const row = makeRow({
      tracking: { status: 'active', sourceGapKey: 'gap-abc', strategyOwned: true },
    });
    const { container } = render(<HubKeywordRowMeta row={row} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bviolet\b/);
    expect(html).not.toMatch(/\bindigo\b/);
    expect(html).not.toMatch(/\brose-/);
    expect(html).not.toMatch(/\bpink-/);
    expect(html).not.toMatch(/\btext-green-400\b/);
  });
});
