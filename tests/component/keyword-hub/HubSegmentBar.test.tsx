/**
 * Tests for HubSegmentBar — the six primary segment pills for the Keyword Hub.
 *
 * Plan P1-T2 assertions:
 * - renders all 6 segment labels
 * - active segment has teal/active styling (aria-pressed=true)
 * - clicking a segment calls onChange with the correct segment id
 * - Local segment shows MapPin icon when active
 * - count Skeleton rendered when isLoading=true
 * - numeric badge when count loaded
 * - "—" when count is undefined
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HubSegmentBar, HUB_SEGMENT_METAS } from '../../../src/components/keyword-hub/HubSegmentBar';
import type { HubSegmentMeta } from '../../../src/components/keyword-hub/HubSegmentBar';
import type { HubSegment } from '../../../src/hooks/admin/useKeywordHubState';
import { MapPin } from 'lucide-react';

// ---------------------------------------------------------------------------
// Helper: build segments with counts
// ---------------------------------------------------------------------------

function makeSegments(overrides: Partial<Record<HubSegment, number | undefined>> = {}): HubSegmentMeta[] {
  const defaults: Record<HubSegment, number | undefined> = {
    all: 120,
    in_strategy: 45,
    tracked: 30,
    needs_review: 12,
    retired: 8,
    local: 22,
  };
  return HUB_SEGMENT_METAS.map((s) => ({
    ...s,
    count: s.id in overrides ? overrides[s.id] : defaults[s.id as HubSegment],
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HubSegmentBar', () => {
  it('renders all 6 segment labels', () => {
    const onChange = vi.fn();
    render(
      <HubSegmentBar
        segments={makeSegments()}
        active="all"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('button', { name: /all segment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /in strategy segment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tracked segment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /needs review segment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retired segment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /local segment/i })).toBeInTheDocument();
  });

  it('marks the active segment with aria-pressed=true', () => {
    render(
      <HubSegmentBar
        segments={makeSegments()}
        active="tracked"
        onChange={vi.fn()}
      />,
    );

    const trackedBtn = screen.getByRole('button', { name: /tracked segment/i });
    expect(trackedBtn).toHaveAttribute('aria-pressed', 'true');

    // Non-active pills are aria-pressed=false
    const allBtn = screen.getByRole('button', { name: /all segment/i });
    expect(allBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the correct segment when clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <HubSegmentBar
        segments={makeSegments()}
        active="all"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /in strategy segment/i }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('in_strategy');
  });

  it('calls onChange with "tracked" when Tracked is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <HubSegmentBar
        segments={makeSegments()}
        active="all"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /tracked segment/i }));
    expect(onChange).toHaveBeenCalledWith('tracked');
  });

  it('calls onChange with "local" when Local is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <HubSegmentBar
        segments={makeSegments()}
        active="all"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /local segment/i }));
    expect(onChange).toHaveBeenCalledWith('local');
  });

  it('shows MapPin icon on Local segment when it is active', () => {
    render(
      <HubSegmentBar
        segments={makeSegments()}
        active="local"
        onChange={vi.fn()}
      />,
    );

    // The button for local is active — its icon is aria-hidden so we look at the button's DOM
    const localBtn = screen.getByRole('button', { name: /local segment/i });
    // MapPin renders as an SVG inside the button when active
    const svgs = within(localBtn).queryAllByRole('img', { hidden: true });
    // The icon is aria-hidden so it's not in the accessible tree — check using querySelector
    const iconEl = localBtn.querySelector('svg');
    expect(iconEl).toBeInTheDocument();
  });

  it('does NOT show MapPin icon on Local segment when it is NOT active', () => {
    render(
      <HubSegmentBar
        segments={makeSegments()}
        active="all"
        onChange={vi.fn()}
      />,
    );

    const localBtn = screen.getByRole('button', { name: /local segment/i });
    const iconEl = localBtn.querySelector('svg');
    // No SVG icon when not active (count badge uses a <span> not SVG)
    expect(iconEl).toBeNull();
  });

  it('renders Skeleton placeholders for counts when isLoading=true', () => {
    const { container } = render(
      <HubSegmentBar
        segments={makeSegments()}
        active="all"
        onChange={vi.fn()}
        isLoading
      />,
    );

    // animate-pulse class is the Skeleton indicator
    const skeletons = container.querySelectorAll('.animate-pulse');
    // One skeleton per segment (6)
    expect(skeletons.length).toBe(6);
  });

  it('renders numeric count badge when count is provided and not loading', () => {
    render(
      <HubSegmentBar
        segments={makeSegments({ all: 99 })}
        active="all"
        onChange={vi.fn()}
      />,
    );

    // The count badge shows "99"
    const allBtn = screen.getByRole('button', { name: /all segment, 99 keywords/i });
    expect(allBtn).toBeInTheDocument();
    // Contains the count value rendered as text
    expect(allBtn.textContent).toContain('99');
  });

  it('renders "—" when count is undefined and not loading', () => {
    const segmentsWithUndefined: HubSegmentMeta[] = HUB_SEGMENT_METAS.map((s) => ({
      ...s,
      count: undefined,
    }));

    render(
      <HubSegmentBar
        segments={segmentsWithUndefined}
        active="all"
        onChange={vi.fn()}
      />,
    );

    // "—" characters should appear for all segments
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBe(6);
  });

  it('does not render Skeleton when count is undefined and isLoading=false', () => {
    const segmentsWithUndefined: HubSegmentMeta[] = HUB_SEGMENT_METAS.map((s) => ({
      ...s,
      count: undefined,
    }));

    const { container } = render(
      <HubSegmentBar
        segments={segmentsWithUndefined}
        active="all"
        onChange={vi.fn()}
        isLoading={false}
      />,
    );

    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(0);
  });

  it('accepts custom segments with icons', () => {
    const customSegments: HubSegmentMeta[] = [
      { id: 'local', label: 'Local', count: 5, icon: MapPin },
    ];

    render(
      <HubSegmentBar
        segments={customSegments}
        active="local"
        onChange={vi.fn()}
      />,
    );

    const localBtn = screen.getByRole('button', { name: /local segment/i });
    const icon = localBtn.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('contains no violet/indigo/rose/pink/text-green-400 class names', () => {
    const { container } = render(
      <HubSegmentBar
        segments={makeSegments()}
        active="all"
        onChange={vi.fn()}
      />,
    );

    const html = container.innerHTML;
    expect(html).not.toMatch(/\bviolet-/);
    expect(html).not.toMatch(/\bindigo-/);
    expect(html).not.toMatch(/\brose-/);
    expect(html).not.toMatch(/\bpink-/);
    expect(html).not.toMatch(/\btext-green-400\b/);
  });
});
