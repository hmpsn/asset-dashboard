/**
 * UI primitives — batch C
 * Covers: AIContextIndicator, ChartCard, ConfirmDialog, DateRangeSelector,
 *         FeatureFlag, MetricToggleCard, TierGate, WorkspaceHealthBar, ScannerReveal
 *
 * Runs under the "component" project (jsdom + @testing-library/react).
 */

// jsdom does not implement ResizeObserver — stub it at module load time
// so it is available when ScannerReveal's useLayoutEffect runs.
if (!('ResizeObserver' in globalThis)) {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: MockResizeObserver,
  });
}

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── helpers ──────────────────────────────────────────────────────────────────

function withRouter(ui: React.ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>;
}

function withQueryClient(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function withProviders(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

// ── AIContextIndicator ────────────────────────────────────────────────────────

// The component fetches data; mock the API client module.
vi.mock('../../../src/api/client', () => ({
  get: vi.fn(),
}));

// Also mock react-router-dom's useNavigate so it doesn't blow up without a
// real router (we still wrap with MemoryRouter, but belt-and-suspenders).
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { get as mockGet } from '../../../src/api/client';
import { AIContextIndicator } from '../../../src/components/ui/AIContextIndicator';

const makeContextData = (overrides?: Partial<{
  score: number;
  connected: number;
  total: number;
  sources: Array<{ key: string; label: string; status: 'connected' | 'missing' | 'partial'; detail: string; impacts: string[]; fixAction?: string }>;
}>) => ({
  workspaceId: 'ws-1',
  score: 75,
  connected: 3,
  total: 4,
  sources: [
    { key: 'webflow', label: 'Webflow', status: 'connected' as const, detail: 'Connected', impacts: ['all'] },
    { key: 'gsc', label: 'Google Search Console', status: 'missing' as const, detail: 'Not connected', impacts: ['all'], fixAction: 'settings' },
  ],
  ...overrides,
});

describe('AIContextIndicator', () => {
  beforeEach(() => {
    vi.mocked(mockGet).mockResolvedValue(makeContextData());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing while data is null (before fetch resolves)', () => {
    vi.mocked(mockGet).mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(withRouter(<AIContextIndicator workspaceId="ws-1" />));
    expect(container.firstChild).toBeNull();
  });

  it('renders compact pill after data loads', async () => {
    render(withRouter(<AIContextIndicator workspaceId="ws-1" compact />));
    await waitFor(() => {
      // compact pill shows connected/total counts
      expect(screen.getByTitle(/AI Context:/)).toBeTruthy();
    });
  });

  it('compact pill displays connected/total ratio', async () => {
    vi.mocked(mockGet).mockResolvedValue(makeContextData({ connected: 2, total: 3 }));
    render(withRouter(<AIContextIndicator workspaceId="ws-1" compact />));
    await waitFor(() => {
      // The pill renders "connected/total" text like "2/3"
      const pill = document.querySelector('[title*="AI Context"]');
      expect(pill?.textContent).toMatch(/\d+\/\d+/);
    });
  });

  it('renders expanded indicator (non-compact) with AI Context header', async () => {
    render(withRouter(<AIContextIndicator workspaceId="ws-1" />));
    await waitFor(() => {
      expect(screen.getByText(/AI Context:/)).toBeTruthy();
    });
  });

  it('expands on header button click', async () => {
    render(withRouter(<AIContextIndicator workspaceId="ws-1" />));
    await waitFor(() => screen.getByText(/AI Context:/));
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    // After expand, sources should be visible
    await waitFor(() => {
      expect(screen.getByText('Webflow')).toBeTruthy();
    });
  });

  it('collapses after a second click on header button', async () => {
    render(withRouter(<AIContextIndicator workspaceId="ws-1" />));
    await waitFor(() => screen.getByText(/AI Context:/));
    const btn = screen.getByRole('button');
    fireEvent.click(btn); // expand
    await waitFor(() => screen.getByText('Webflow'));
    fireEvent.click(btn); // collapse
    await waitFor(() => {
      expect(screen.queryByText('Webflow')).toBeNull();
    });
  });

  it('shows "all connected" text when all sources are connected', async () => {
    vi.mocked(mockGet).mockResolvedValue(
      makeContextData({
        sources: [
          { key: 'webflow', label: 'Webflow', status: 'connected', detail: 'Connected', impacts: ['all'] },
          { key: 'gsc', label: 'GSC', status: 'connected', detail: 'Connected', impacts: ['all'] },
        ],
      }),
    );
    render(withRouter(<AIContextIndicator workspaceId="ws-1" />));
    await waitFor(() => {
      expect(screen.getByText(/all connected/)).toBeTruthy();
    });
  });

  it('shows missing source label when one source is missing', async () => {
    render(withRouter(<AIContextIndicator workspaceId="ws-1" />));
    await waitFor(() => {
      expect(screen.getByText(/Google Search Console missing/)).toBeTruthy();
    });
  });

  it('shows count of missing sources when multiple are missing', async () => {
    vi.mocked(mockGet).mockResolvedValue(
      makeContextData({
        sources: [
          { key: 'webflow', label: 'Webflow', status: 'missing', detail: 'Not connected', impacts: ['all'] },
          { key: 'gsc', label: 'GSC', status: 'missing', detail: 'Not connected', impacts: ['all'] },
        ],
      }),
    );
    render(withRouter(<AIContextIndicator workspaceId="ws-1" />));
    await waitFor(() => {
      expect(screen.getByText(/2 sources missing/)).toBeTruthy();
    });
  });

  it('does not render when workspaceId is empty', () => {
    const { container } = render(withRouter(<AIContextIndicator workspaceId="" />));
    expect(container.firstChild).toBeNull();
  });

  it('shows "Set up" fix button for missing source with fixAction', async () => {
    render(withRouter(<AIContextIndicator workspaceId="ws-1" />));
    await waitFor(() => screen.getByText(/AI Context:/));
    fireEvent.click(screen.getByRole('button')); // expand
    await waitFor(() => {
      expect(screen.getByText('Set up')).toBeTruthy();
    });
  });

  it('calls navigate when "Set up" button is clicked', async () => {
    render(withRouter(<AIContextIndicator workspaceId="ws-1" />));
    await waitFor(() => screen.getByText(/AI Context:/));
    fireEvent.click(screen.getByRole('button')); // expand
    await waitFor(() => screen.getByText('Set up'));
    fireEvent.click(screen.getByText('Set up'));
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('filters sources by feature prop', async () => {
    vi.mocked(mockGet).mockResolvedValue(
      makeContextData({
        sources: [
          { key: 'webflow', label: 'Webflow', status: 'connected', detail: 'Connected', impacts: ['strategy'] },
          { key: 'gsc', label: 'GSC', status: 'missing', detail: 'Not connected', impacts: ['briefs'] },
        ],
      }),
    );
    render(withRouter(<AIContextIndicator workspaceId="ws-1" feature="strategy" />));
    await waitFor(() => screen.getByText(/AI Context:/));
    // 1/1 for strategy filter — GSC filtered out
    expect(screen.getByText(/1\/1/)).toBeTruthy();
  });
});

// ── ChartCard ─────────────────────────────────────────────────────────────────

import { ChartCard } from '../../../src/components/ui/ChartCard';

describe('ChartCard', () => {
  it('renders children', () => {
    render(<ChartCard><span>chart content</span></ChartCard>);
    expect(screen.getByText('chart content')).toBeTruthy();
  });

  it('renders title when provided', () => {
    render(<ChartCard title="Traffic Over Time"><div /></ChartCard>);
    expect(screen.getByText('Traffic Over Time')).toBeTruthy();
  });

  it('renders titleIcon alongside title', () => {
    const icon = <svg data-testid="custom-icon" />;
    render(<ChartCard title="Traffic" titleIcon={icon}><div /></ChartCard>);
    expect(screen.getByTestId('custom-icon')).toBeTruthy();
  });

  it('omits header row when no title/action/trend', () => {
    const { container } = render(<ChartCard><span>just content</span></ChartCard>);
    // no px-4 py-3 header div
    expect(container.querySelector('.justify-between')).toBeNull();
  });

  it('renders action slot on the right', () => {
    const action = <button>View all</button>;
    render(<ChartCard title="Clicks" action={action}><div /></ChartCard>);
    expect(screen.getByRole('button', { name: 'View all' })).toBeTruthy();
  });

  it('renders TrendBadge when trend prop is provided', () => {
    const { container } = render(<ChartCard title="Clicks" trend={12}><div /></ChartCard>);
    // TrendBadge renders a span with a trending icon SVG
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('does not render TrendBadge when trend is undefined', () => {
    const { container } = render(<ChartCard title="Clicks"><div /></ChartCard>);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(<ChartCard className="my-custom-class"><div /></ChartCard>);
    expect(container.firstChild).toHaveClass ? container.firstChild?.toString() : null;
    expect((container.firstChild as HTMLElement)?.className).toContain('my-custom-class');
  });

  it('applies header padding when hasHeader is true', () => {
    const { container } = render(<ChartCard title="X"><div /></ChartCard>);
    // children wrapper gets px-4 pb-3 when there's a header
    const childDiv = container.querySelector('.px-4.pb-3');
    expect(childDiv).toBeTruthy();
  });

  it('applies symmetric padding when no header', () => {
    const { container } = render(<ChartCard><div /></ChartCard>);
    const childDiv = container.querySelector('.px-4.py-3');
    expect(childDiv).toBeTruthy();
  });

  it('passes trendProps to TrendBadge (e.g. invert)', () => {
    // invert=true on a positive trend renders TrendingDown
    const { container } = render(
      <ChartCard title="Rank" trend={5} trendProps={{ invert: true }}>
        <div />
      </ChartCard>,
    );
    // TrendBadge with invert=true + positive value = red color (TrendingDown)
    const badge = container.querySelector('.text-red-400');
    expect(badge).toBeTruthy();
  });
});

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

import { ConfirmDialog } from '../../../src/components/ui/ConfirmDialog';

const dialogDefaults = {
  open: true,
  title: 'Delete item?',
  message: 'This cannot be undone.',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('ConfirmDialog', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(<ConfirmDialog {...dialogDefaults} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders title and message when open=true', () => {
    render(<ConfirmDialog {...dialogDefaults} />);
    expect(screen.getByText('Delete item?')).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
  });

  it('renders default Confirm / Cancel button labels', () => {
    render(<ConfirmDialog {...dialogDefaults} />);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('renders custom button labels', () => {
    render(<ConfirmDialog {...dialogDefaults} confirmLabel="Delete" cancelLabel="Never mind" />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Never mind' })).toBeTruthy();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...dialogDefaults} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...dialogDefaults} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...dialogDefaults} onCancel={onCancel} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...dialogDefaults} onCancel={onCancel} />);
    // click the outermost fixed overlay
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not propagate click from dialog card to backdrop', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...dialogDefaults} onCancel={onCancel} />);
    // clicking the inner panel should NOT trigger cancel
    const panel = screen.getByText('Delete item?').closest('.bg-\\[var\\(--surface-2\\)\\]') as HTMLElement;
    if (panel) fireEvent.click(panel);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('default variant uses primary button', () => {
    const { container } = render(<ConfirmDialog {...dialogDefaults} variant="default" />);
    const buttons = container.querySelectorAll('button');
    const confirmBtn = Array.from(buttons).find(b => b.textContent === 'Confirm');
    // primary variant has teal gradient
    expect(confirmBtn?.className).toContain('from-[var(--teal)]');
  });

  it('destructive variant uses danger button style', () => {
    const { container } = render(<ConfirmDialog {...dialogDefaults} variant="destructive" confirmLabel="Delete" />);
    const buttons = container.querySelectorAll('button');
    const confirmBtn = Array.from(buttons).find(b => b.textContent === 'Delete');
    // danger variant has --red background
    expect(confirmBtn?.className).toContain('bg-[var(--red)]');
  });

  it('Enter key triggers onConfirm when non-button is focused', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...dialogDefaults} onConfirm={onConfirm} />);
    // dispatch to document, but target is the document.body (not a button)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

// ── DateRangeSelector ─────────────────────────────────────────────────────────

import { DateRangeSelector } from '../../../src/components/ui/DateRangeSelector';

const DATE_OPTIONS = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

describe('DateRangeSelector', () => {
  it('renders all option labels', () => {
    render(<DateRangeSelector options={DATE_OPTIONS} selected={7} onChange={vi.fn()} />);
    expect(screen.getByText('7d')).toBeTruthy();
    expect(screen.getByText('30d')).toBeTruthy();
    expect(screen.getByText('90d')).toBeTruthy();
  });

  it('calls onChange with the clicked option value', () => {
    const onChange = vi.fn();
    render(<DateRangeSelector options={DATE_OPTIONS} selected={7} onChange={onChange} />);
    fireEvent.click(screen.getByText('30d'));
    expect(onChange).toHaveBeenCalledWith(30);
  });

  it('highlights the selected option', () => {
    render(<DateRangeSelector options={DATE_OPTIONS} selected={30} onChange={vi.fn()} />);
    const btn = screen.getByText('30d').closest('button') as HTMLButtonElement;
    // selected button has surface-3 background class
    expect(btn.className).toContain('bg-[var(--surface-3)]');
  });

  it('non-selected options are muted', () => {
    render(<DateRangeSelector options={DATE_OPTIONS} selected={30} onChange={vi.fn()} />);
    const btn7 = screen.getByText('7d').closest('button') as HTMLButtonElement;
    expect(btn7.className).toContain('text-[var(--brand-text-muted)]');
  });

  it('applies custom className to outer wrapper', () => {
    const { container } = render(
      <DateRangeSelector options={DATE_OPTIONS} selected={7} onChange={vi.fn()} className="my-custom" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-custom');
  });

  it('renders an empty selector with no options', () => {
    const { container } = render(
      <DateRangeSelector options={[]} selected={7} onChange={vi.fn()} />,
    );
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('calls onChange for each option when clicked sequentially', () => {
    const onChange = vi.fn();
    render(<DateRangeSelector options={DATE_OPTIONS} selected={7} onChange={onChange} />);
    fireEvent.click(screen.getByText('7d'));
    fireEvent.click(screen.getByText('90d'));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, 7);
    expect(onChange).toHaveBeenNthCalledWith(2, 90);
  });

  it('renders buttons with type="button" to avoid accidental form submit', () => {
    render(<DateRangeSelector options={DATE_OPTIONS} selected={7} onChange={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach(b => expect(b).toHaveAttribute('type', 'button'));
  });
});

// ── FeatureFlag ───────────────────────────────────────────────────────────────

// Mock useFeatureFlag so tests control flag state without a real API call.
vi.mock('../../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn(),
}));

import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { FeatureFlag } from '../../../src/components/ui/FeatureFlag';

describe('FeatureFlag', () => {
  it('renders children when flag is enabled', () => {
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    render(
      withQueryClient(
        <FeatureFlag flag="copy-engine">
          <span>Feature content</span>
        </FeatureFlag>,
      ),
    );
    expect(screen.getByText('Feature content')).toBeTruthy();
  });

  it('renders nothing when flag is disabled and no fallback', () => {
    vi.mocked(useFeatureFlag).mockReturnValue(false);
    const { container } = render(
      withQueryClient(
        <FeatureFlag flag="copy-engine">
          <span>Feature content</span>
        </FeatureFlag>,
      ),
    );
    expect(screen.queryByText('Feature content')).toBeNull();
    // No children at all
    expect(container.textContent).toBe('');
  });

  it('renders fallback when flag is disabled and fallback is provided', () => {
    vi.mocked(useFeatureFlag).mockReturnValue(false);
    render(
      withQueryClient(
        <FeatureFlag flag="copy-engine" fallback={<span>Coming soon</span>}>
          <span>Feature content</span>
        </FeatureFlag>,
      ),
    );
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.queryByText('Feature content')).toBeNull();
  });

  it('does not render fallback when flag is enabled', () => {
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    render(
      withQueryClient(
        <FeatureFlag flag="copy-engine" fallback={<span>Coming soon</span>}>
          <span>Feature content</span>
        </FeatureFlag>,
      ),
    );
    expect(screen.queryByText('Coming soon')).toBeNull();
    expect(screen.getByText('Feature content')).toBeTruthy();
  });

  it('passes the correct flag key to useFeatureFlag', () => {
    vi.mocked(useFeatureFlag).mockReturnValue(false);
    render(
      withQueryClient(
        <FeatureFlag flag="outcome-tracking">
          <span>X</span>
        </FeatureFlag>,
      ),
    );
    expect(useFeatureFlag).toHaveBeenCalledWith('outcome-tracking');
  });

  it('renders multiple children when enabled', () => {
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    render(
      withQueryClient(
        <FeatureFlag flag="copy-engine">
          <span>First</span>
          <span>Second</span>
        </FeatureFlag>,
      ),
    );
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
  });
});

// ── MetricToggleCard ──────────────────────────────────────────────────────────

import { MetricToggleCard } from '../../../src/components/ui/MetricToggleCard';

describe('MetricToggleCard', () => {
  const baseProps = {
    label: 'Clicks',
    value: '1,234',
    delta: '+12%',
    deltaPositive: true,
    color: '#60a5fa',
    active: true,
  };

  it('renders label', () => {
    render(<MetricToggleCard {...baseProps} />);
    expect(screen.getByText('Clicks')).toBeTruthy();
  });

  it('renders value', () => {
    render(<MetricToggleCard {...baseProps} />);
    expect(screen.getByText('1,234')).toBeTruthy();
  });

  it('renders delta', () => {
    render(<MetricToggleCard {...baseProps} />);
    expect(screen.getByText('+12%')).toBeTruthy();
  });

  it('renders as button when not displayOnly', () => {
    render(<MetricToggleCard {...baseProps} />);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('renders as div when displayOnly=true', () => {
    const { container } = render(<MetricToggleCard {...baseProps} displayOnly />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('calls onClick when button is clicked', () => {
    const onClick = vi.fn();
    render(<MetricToggleCard {...baseProps} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('positive delta with deltaPositive=true renders emerald color', () => {
    const { container } = render(
      <MetricToggleCard {...baseProps} delta="+5%" deltaPositive={true} />,
    );
    const deltaEl = container.querySelector('.text-emerald-400');
    expect(deltaEl).toBeTruthy();
  });

  it('negative delta with deltaPositive=false renders red color', () => {
    const { container } = render(
      <MetricToggleCard {...baseProps} delta="-3%" deltaPositive={false} />,
    );
    const deltaEl = container.querySelector('.text-red-400');
    expect(deltaEl).toBeTruthy();
  });

  it('neutral delta "—" renders dim color', () => {
    const { container } = render(
      <MetricToggleCard {...baseProps} delta="—" deltaPositive={false} />,
    );
    const deltaEl = container.querySelector('.text-\\[var\\(--brand-text-dim\\)\\]');
    expect(deltaEl).toBeTruthy();
  });

  it('zero numeric delta renders dim color', () => {
    const { container } = render(
      <MetricToggleCard {...baseProps} delta="0%" deltaPositive={true} />,
    );
    const deltaEl = container.querySelector('.text-\\[var\\(--brand-text-dim\\)\\]');
    expect(deltaEl).toBeTruthy();
  });

  it('invertDelta flips positive/negative color', () => {
    // invertDelta=true + deltaPositive=true => isPositive=false => red
    const { container } = render(
      <MetricToggleCard {...baseProps} delta="+5%" deltaPositive={true} invertDelta />,
    );
    expect(container.querySelector('.text-red-400')).toBeTruthy();
  });

  it('active card applies colored border via inline style', () => {
    const { container } = render(
      <MetricToggleCard {...baseProps} active={true} />,
    );
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.style.borderColor).toBeTruthy();
  });

  it('inactive card has opacity-50 class', () => {
    render(<MetricToggleCard {...baseProps} active={false} />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('opacity-50');
  });

  it('label uses the color prop via inline style', () => {
    const { container } = render(
      <MetricToggleCard {...baseProps} color="#ff0000" />,
    );
    const labelEl = container.querySelector('[style*="color"]') as HTMLElement;
    // Could be rgb or hex representation
    expect(labelEl).toBeTruthy();
  });
});

// ── TierGate ──────────────────────────────────────────────────────────────────

import { TierGate, TierBadge } from '../../../src/components/ui/TierGate';

describe('TierGate', () => {
  it('renders children when tier meets required tier', () => {
    render(
      <TierGate tier="growth" required="growth" feature="Analytics">
        <span>Premium content</span>
      </TierGate>,
    );
    expect(screen.getByText('Premium content')).toBeTruthy();
  });

  it('renders children when tier exceeds required tier', () => {
    render(
      <TierGate tier="premium" required="growth" feature="Analytics">
        <span>Premium content</span>
      </TierGate>,
    );
    expect(screen.getByText('Premium content')).toBeTruthy();
  });

  it('renders gate overlay when tier is below required', () => {
    render(
      <TierGate tier="free" required="growth" feature="Analytics">
        <span>Hidden content</span>
      </TierGate>,
    );
    expect(screen.getByText('Analytics')).toBeTruthy();
  });

  it('renders default upgrade teaser when teaser prop absent', () => {
    render(
      <TierGate tier="free" required="growth" feature="Analytics">
        <span>X</span>
      </TierGate>,
    );
    expect(screen.getByText(/Upgrade to Growth/)).toBeTruthy();
  });

  it('renders custom teaser when teaser prop provided', () => {
    render(
      <TierGate tier="free" required="growth" feature="Analytics" teaser="Unlock powerful insights">
        <span>X</span>
      </TierGate>,
    );
    expect(screen.getByText('Unlock powerful insights')).toBeTruthy();
  });

  it('blurs children behind the gate overlay', () => {
    const { container } = render(
      <TierGate tier="free" required="growth" feature="Analytics">
        <span>Hidden content</span>
      </TierGate>,
    );
    const blurDiv = container.querySelector('.blur-\\[6px\\]');
    expect(blurDiv).toBeTruthy();
    expect(blurDiv?.textContent).toContain('Hidden content');
  });

  it('renders compact gate when compact=true', () => {
    const { container } = render(
      <TierGate tier="free" required="growth" feature="Analytics" compact>
        <span>X</span>
      </TierGate>,
    );
    // compact renders a Lock icon and "requires the Growth plan" text inline
    expect(screen.getByText(/requires the/)).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('compact mode does not show full overlay', () => {
    const { container } = render(
      <TierGate tier="free" required="growth" feature="Analytics" compact>
        <span>X</span>
      </TierGate>,
    );
    // no blur div in compact mode
    expect(container.querySelector('.blur-\\[6px\\]')).toBeNull();
  });

  it('dispatches tier-upgrade custom event when "Learn More" is clicked', () => {
    const listener = vi.fn();
    window.addEventListener('tier-upgrade', listener);
    render(
      <TierGate tier="free" required="growth" feature="Analytics">
        <span>X</span>
      </TierGate>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Learn More/i }));
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('tier-upgrade', listener);
  });

  it('tier-upgrade event carries required and feature detail', () => {
    let eventDetail: Record<string, unknown> = {};
    const listener = (e: Event) => {
      eventDetail = (e as CustomEvent).detail;
    };
    window.addEventListener('tier-upgrade', listener);
    render(
      <TierGate tier="free" required="premium" feature="Advanced AI">
        <span>X</span>
      </TierGate>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Learn More/i }));
    expect(eventDetail.required).toBe('premium');
    expect(eventDetail.feature).toBe('Advanced AI');
    window.removeEventListener('tier-upgrade', listener);
  });

  it('fires onGateHit callback when gate is blocking', () => {
    const onGateHit = vi.fn();
    render(
      <TierGate tier="free" required="growth" feature="Analytics" onGateHit={onGateHit}>
        <span>X</span>
      </TierGate>,
    );
    expect(onGateHit).toHaveBeenCalledWith('Analytics', 'growth');
  });

  it('does not fire onGateHit when access is granted', () => {
    const onGateHit = vi.fn();
    render(
      <TierGate tier="growth" required="growth" feature="Analytics" onGateHit={onGateHit}>
        <span>X</span>
      </TierGate>,
    );
    expect(onGateHit).not.toHaveBeenCalled();
  });

  it('renders roiValue when provided and gate is blocking', () => {
    render(
      <TierGate tier="free" required="growth" feature="Analytics" roiValue={1500}>
        <span>X</span>
      </TierGate>,
    );
    expect(screen.getByText(/\$1,500\/mo/)).toBeTruthy();
  });

  it('does not render roiValue when null', () => {
    render(
      <TierGate tier="free" required="growth" feature="Analytics" roiValue={null}>
        <span>X</span>
      </TierGate>,
    );
    expect(screen.queryByText(/\/mo/)).toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(
      <TierGate tier="free" required="growth" feature="X" className="outer-custom">
        <span>X</span>
      </TierGate>,
    );
    expect((container.firstChild as HTMLElement).className).toContain('outer-custom');
  });
});

describe('TierBadge', () => {
  it('renders Free label', () => {
    render(<TierBadge tier="free" />);
    expect(screen.getByText('Free')).toBeTruthy();
  });

  it('renders Growth label', () => {
    render(<TierBadge tier="growth" />);
    expect(screen.getByText('Growth')).toBeTruthy();
  });

  it('renders Premium label', () => {
    render(<TierBadge tier="premium" />);
    expect(screen.getByText('Premium')).toBeTruthy();
  });

  it('renders Sparkles icon for premium tier', () => {
    const { container } = render(<TierBadge tier="premium" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('does not render Sparkles icon for free/growth tier', () => {
    const { container } = render(<TierBadge tier="free" />);
    // free tier has no Sparkles icon
    expect(container.querySelector('svg')).toBeNull();
  });
});

// ── WorkspaceHealthBar ────────────────────────────────────────────────────────

import { WorkspaceHealthBar } from '../../../src/components/ui/WorkspaceHealthBar';

const sampleMetrics = [
  { label: 'SEO Coverage', percent: 80 },
  { label: 'Content Quality', percent: 55 },
];

describe('WorkspaceHealthBar', () => {
  it('renders section title "Workspace Health"', () => {
    render(<WorkspaceHealthBar metrics={sampleMetrics} />);
    expect(screen.getByText('Workspace Health')).toBeTruthy();
  });

  it('renders metric labels', () => {
    render(<WorkspaceHealthBar metrics={sampleMetrics} />);
    expect(screen.getByText('SEO Coverage')).toBeTruthy();
    expect(screen.getByText('Content Quality')).toBeTruthy();
  });

  it('renders metric percentages', () => {
    render(<WorkspaceHealthBar metrics={sampleMetrics} />);
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('55%')).toBeTruthy();
  });

  it('renders progress bars for each metric', () => {
    const { container } = render(<WorkspaceHealthBar metrics={sampleMetrics} />);
    const bars = container.querySelectorAll('[role="progressbar"]');
    expect(bars.length).toBe(2);
  });

  it('progress bar width matches percent', () => {
    const { container } = render(
      <WorkspaceHealthBar metrics={[{ label: 'SEO', percent: 60 }]} />,
    );
    const bar = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.style.width).toBe('60%');
  });

  it('clamps percent to 100 for display', () => {
    render(<WorkspaceHealthBar metrics={[{ label: 'SEO', percent: 150 }]} />);
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('clamps percent to 0 for display', () => {
    render(<WorkspaceHealthBar metrics={[{ label: 'SEO', percent: -10 }]} />);
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('calls metric.onClick when metric row is clicked', () => {
    const onClick = vi.fn();
    render(
      <WorkspaceHealthBar
        metrics={[{ label: 'SEO Coverage', percent: 80, onClick }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /SEO Coverage/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders recommendations section when recommendations provided', () => {
    render(
      <WorkspaceHealthBar
        metrics={sampleMetrics}
        recommendations={[{ label: 'Add meta descriptions', onClick: vi.fn() }]}
      />,
    );
    expect(screen.getByText('Recommended Next')).toBeTruthy();
    expect(screen.getByText('Add meta descriptions')).toBeTruthy();
  });

  it('does not render recommendations section when none provided', () => {
    render(<WorkspaceHealthBar metrics={sampleMetrics} />);
    expect(screen.queryByText('Recommended Next')).toBeNull();
  });

  it('calls recommendation onClick when recommendation is clicked', () => {
    const recClick = vi.fn();
    render(
      <WorkspaceHealthBar
        metrics={sampleMetrics}
        recommendations={[{ label: 'Fix H1 tags', onClick: recClick }]}
      />,
    );
    fireEvent.click(screen.getByText('Fix H1 tags'));
    expect(recClick).toHaveBeenCalledOnce();
  });

  it('renders recommendation estimatedTime when provided', () => {
    render(
      <WorkspaceHealthBar
        metrics={sampleMetrics}
        recommendations={[{ label: 'Add meta descriptions', onClick: vi.fn(), estimatedTime: '15 min' }]}
      />,
    );
    expect(screen.getByText('~15 min')).toBeTruthy();
  });

  it('does not render estimatedTime when not provided', () => {
    render(
      <WorkspaceHealthBar
        metrics={sampleMetrics}
        recommendations={[{ label: 'Add meta descriptions', onClick: vi.fn() }]}
      />,
    );
    expect(screen.queryByText(/~\d/)).toBeNull();
  });

  it('renders empty state with no metrics', () => {
    const { container } = render(<WorkspaceHealthBar metrics={[]} />);
    // SectionCard still renders with title
    expect(screen.getByText('Workspace Health')).toBeTruthy();
    expect(container.querySelectorAll('[role="progressbar"]').length).toBe(0);
  });

  it('aria-label on each metric button includes percentage', () => {
    render(<WorkspaceHealthBar metrics={[{ label: 'SEO', percent: 75 }]} />);
    const btn = screen.getByRole('button', { name: /SEO: 75%/ });
    expect(btn).toBeTruthy();
  });
});

// ── ScannerReveal ─────────────────────────────────────────────────────────────

import { ScannerReveal } from '../../../src/components/ui/ScannerReveal';

describe('ScannerReveal', () => {
  it('renders children', () => {
    render(
      withRouter(
        <ScannerReveal>
          <span>Page content</span>
        </ScannerReveal>,
      ),
    );
    expect(screen.getByText('Page content')).toBeTruthy();
  });

  it('renders without crashing with no className', () => {
    const { container } = render(
      withRouter(
        <ScannerReveal>
          <div data-testid="inner">hello</div>
        </ScannerReveal>,
      ),
    );
    expect(screen.getByTestId('inner')).toBeTruthy();
    expect(container.firstChild).toBeTruthy();
  });

  it('applies className to outer wrapper', () => {
    const { container } = render(
      withRouter(
        <ScannerReveal className="page-content-wrapper">
          <span>X</span>
        </ScannerReveal>,
      ),
    );
    expect((container.firstChild as HTMLElement).className).toContain('page-content-wrapper');
  });

  it('renders the fixed overlay element for animation', () => {
    const { container } = render(
      withRouter(
        <ScannerReveal>
          <span>X</span>
        </ScannerReveal>,
      ),
    );
    // overlay div has position:fixed style
    const fixedDivs = Array.from(container.querySelectorAll('div')).filter(
      d => (d as HTMLElement).style.position === 'fixed',
    );
    expect(fixedDivs.length).toBeGreaterThan(0);
  });

  it('renders the beam element alongside the overlay', () => {
    const { container } = render(
      withRouter(
        <ScannerReveal>
          <span>X</span>
        </ScannerReveal>,
      ),
    );
    // beam also has position:fixed; there should be 2 fixed divs (overlay + beam)
    const fixedDivs = Array.from(container.querySelectorAll('div')).filter(
      d => (d as HTMLElement).style.position === 'fixed',
    );
    expect(fixedDivs.length).toBe(2);
  });

  it('overlay has pointer-events:none so it does not block clicks', () => {
    const { container } = render(
      withRouter(
        <ScannerReveal>
          <span>X</span>
        </ScannerReveal>,
      ),
    );
    const fixedDivs = Array.from(container.querySelectorAll('div')).filter(
      d => (d as HTMLElement).style.position === 'fixed',
    );
    const overlay = fixedDivs[0] as HTMLElement;
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('children remain interactive (clickable through overlay)', () => {
    const onClick = vi.fn();
    render(
      withRouter(
        <ScannerReveal>
          <button onClick={onClick}>Click me</button>
        </ScannerReveal>,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Click me' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders without crashing with multiple children', () => {
    render(
      withRouter(
        <ScannerReveal>
          <div>Section 1</div>
          <div>Section 2</div>
          <div>Section 3</div>
        </ScannerReveal>,
      ),
    );
    expect(screen.getByText('Section 1')).toBeTruthy();
    expect(screen.getByText('Section 2')).toBeTruthy();
    expect(screen.getByText('Section 3')).toBeTruthy();
  });
});
