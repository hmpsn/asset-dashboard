/**
 * Tests for HubAdvancedFilters — the non-primary filter dropdown.
 *
 * Plan P1-T2 assertions:
 * - renders "Filters" button
 * - opens list on click (aria-expanded changes / <details> opens)
 * - selecting a filter calls onChange(filterId) and closes dropdown
 * - clear button appears when a filter is active
 * - clear calls onChange(null)
 * - does NOT include primary segment filters (all, striking_distance, in_strategy,
 *   tracked, needs_review, retired, local)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HubAdvancedFilters } from '../../../src/components/keyword-hub/HubAdvancedFilters';
import type { KeywordCommandCenterFilter, KeywordCommandCenterFilterMeta } from '../../../shared/types/keyword-command-center';
import { KEYWORD_COMMAND_CENTER_FILTERS } from '../../../shared/types/keyword-command-center';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a representative set of all filters (primary + non-primary). */
function allFilterMetas(): KeywordCommandCenterFilterMeta[] {
  return [
    { id: KEYWORD_COMMAND_CENTER_FILTERS.ALL, label: 'All', count: 120 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY, label: 'In Strategy', count: 45 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED, label: 'Tracked', count: 30 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW, label: 'Needs Review', count: 12 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.RETIRED, label: 'Retired', count: 8 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL, label: 'Local', count: 22 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.STRIKING_DISTANCE, label: 'Striking Distance', count: 14 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.CONTENT, label: 'Content', count: 15 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED, label: 'Page Assigned', count: 10 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE, label: 'Raw Evidence', count: 5 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES, label: 'Local Candidates', count: 3 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY, label: 'Visible Locally', count: 7 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH, label: 'Possible Match', count: 2 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE, label: 'Not Visible', count: 4 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED, label: 'Not Checked', count: 6 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED, label: 'Provider Degraded', count: 1 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED, label: 'Requested', count: 9 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.DECLINED, label: 'Declined', count: 11 },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY, label: 'Lost Visibility', count: 13 },
  ];
}

/** Helper: open the <details> dropdown. */
function openDropdown() {
  const summary = screen.getByRole('group') ?? document.querySelector('summary');
  // Use querySelector since <summary> doesn't have an accessible role by default
  const summaryEl = document.querySelector('details > summary');
  if (summaryEl) {
    fireEvent.click(summaryEl);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HubAdvancedFilters', () => {
  it('renders a Filters button (summary element)', () => {
    render(
      <HubAdvancedFilters
        activeAdvancedFilter={null}
        filterMetas={allFilterMetas()}
        onChange={vi.fn()}
      />,
    );

    // The summary element contains the text "Filters"
    const summaryEl = document.querySelector('details > summary');
    expect(summaryEl).toBeInTheDocument();
    expect(summaryEl!.textContent).toContain('Filters');
  });

  it('opens the dropdown list when the summary is clicked', () => {
    render(
      <HubAdvancedFilters
        activeAdvancedFilter={null}
        filterMetas={allFilterMetas()}
        onChange={vi.fn()}
      />,
    );

    const detailsEl = document.querySelector('details') as HTMLDetailsElement;
    expect(detailsEl.open).toBe(false);

    const summaryEl = document.querySelector('details > summary')!;
    fireEvent.click(summaryEl);

    expect(detailsEl.open).toBe(true);
  });

  it('renders a listbox when open', () => {
    render(
      <HubAdvancedFilters
        activeAdvancedFilter={null}
        filterMetas={allFilterMetas()}
        onChange={vi.fn()}
      />,
    );

    // Open the details
    const summaryEl = document.querySelector('details > summary')!;
    fireEvent.click(summaryEl);

    // There should be a listbox element
    const listbox = screen.getByRole('listbox', { name: /advanced filters/i });
    expect(listbox).toBeInTheDocument();
  });

  it('does NOT include the primary segment filters in the dropdown', () => {
    render(
      <HubAdvancedFilters
        activeAdvancedFilter={null}
        filterMetas={allFilterMetas()}
        onChange={vi.fn()}
      />,
    );

    const summaryEl = document.querySelector('details > summary')!;
    fireEvent.click(summaryEl);

    const listbox = screen.getByRole('listbox', { name: /advanced filters/i });
    const listboxText = listbox.textContent ?? '';

    // Primary filters must NOT appear in the dropdown
    expect(listboxText).not.toContain('In Strategy');
    expect(listboxText).not.toContain('Striking Distance');
    expect(listboxText).not.toContain('Needs Review');
    expect(listboxText).not.toContain('Retired');

    // The label "All" is part of the primary set — not in dropdown
    const options = within(listbox).queryAllByRole('option');
    const optionLabels = options.map((o) => o.textContent);
    const hasAllOption = optionLabels.some((l) => l?.trim() === 'All');
    expect(hasAllOption).toBe(false);
  });

  it('includes non-primary filters in the dropdown', () => {
    render(
      <HubAdvancedFilters
        activeAdvancedFilter={null}
        filterMetas={allFilterMetas()}
        onChange={vi.fn()}
      />,
    );

    const summaryEl = document.querySelector('details > summary')!;
    fireEvent.click(summaryEl);

    const listbox = screen.getByRole('listbox', { name: /advanced filters/i });

    // Non-primary filters should appear
    expect(within(listbox).getByRole('option', { name: /content/i })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /page assigned/i })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /raw evidence/i })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /local candidates/i })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /visible locally/i })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /possible match/i })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /not visible/i })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /not checked/i })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /provider degraded/i })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /requested/i })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /declined/i })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /lost visibility/i })).toBeInTheDocument();
  });

  it('calls onChange with the selected filterId when an option is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <HubAdvancedFilters
        activeAdvancedFilter={null}
        filterMetas={allFilterMetas()}
        onChange={onChange}
      />,
    );

    // Open dropdown
    const summaryEl = document.querySelector('details > summary')!;
    fireEvent.click(summaryEl);

    // Click "Content"
    const contentOption = screen.getByRole('option', { name: /content/i });
    await user.click(contentOption);

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT);
  });

  it('closes the dropdown after selecting a filter', async () => {
    const user = userEvent.setup();

    render(
      <HubAdvancedFilters
        activeAdvancedFilter={null}
        filterMetas={allFilterMetas()}
        onChange={vi.fn()}
      />,
    );

    const summaryEl = document.querySelector('details > summary')!;
    fireEvent.click(summaryEl);

    const detailsEl = document.querySelector('details') as HTMLDetailsElement;
    expect(detailsEl.open).toBe(true);

    const contentOption = screen.getByRole('option', { name: /content/i });
    await user.click(contentOption);

    expect(detailsEl.open).toBe(false);
  });

  it('shows clear button when activeAdvancedFilter is set', () => {
    render(
      <HubAdvancedFilters
        activeAdvancedFilter={KEYWORD_COMMAND_CENTER_FILTERS.CONTENT}
        filterMetas={allFilterMetas()}
        onChange={vi.fn()}
      />,
    );

    const clearBtn = screen.getByRole('button', { name: /clear filter/i });
    expect(clearBtn).toBeInTheDocument();
  });

  it('does NOT show clear button when activeAdvancedFilter is null', () => {
    render(
      <HubAdvancedFilters
        activeAdvancedFilter={null}
        filterMetas={allFilterMetas()}
        onChange={vi.fn()}
      />,
    );

    const clearBtn = screen.queryByRole('button', { name: /clear filter/i });
    expect(clearBtn).toBeNull();
  });

  it('calls onChange(null) when clear button is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <HubAdvancedFilters
        activeAdvancedFilter={KEYWORD_COMMAND_CENTER_FILTERS.CONTENT}
        filterMetas={allFilterMetas()}
        onChange={onChange}
      />,
    );

    const clearBtn = screen.getByRole('button', { name: /clear filter/i });
    await user.click(clearBtn);

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows the active filter label in the summary when a filter is active', () => {
    render(
      <HubAdvancedFilters
        activeAdvancedFilter={KEYWORD_COMMAND_CENTER_FILTERS.CONTENT}
        filterMetas={allFilterMetas()}
        onChange={vi.fn()}
      />,
    );

    const summaryEl = document.querySelector('details > summary')!;
    expect(summaryEl.textContent).toContain('Content');
  });

  it('marks the active filter option as aria-selected=true', () => {
    render(
      <HubAdvancedFilters
        activeAdvancedFilter={KEYWORD_COMMAND_CENTER_FILTERS.CONTENT}
        filterMetas={allFilterMetas()}
        onChange={vi.fn()}
      />,
    );

    // Open dropdown
    const summaryEl = document.querySelector('details > summary')!;
    fireEvent.click(summaryEl);

    const contentOption = screen.getByRole('option', { name: /content/i });
    expect(contentOption).toHaveAttribute('aria-selected', 'true');

    // Other options not selected
    const pageAssignedOption = screen.getByRole('option', { name: /page assigned/i });
    expect(pageAssignedOption).toHaveAttribute('aria-selected', 'false');
  });

  it('shows "No additional filters available" when filterMetas is empty', () => {
    render(
      <HubAdvancedFilters
        activeAdvancedFilter={null}
        filterMetas={[]}
        onChange={vi.fn()}
      />,
    );

    // Open dropdown
    const summaryEl = document.querySelector('details > summary')!;
    fireEvent.click(summaryEl);

    expect(screen.getByText(/no additional filters available/i)).toBeInTheDocument();
  });

  it('contains no violet/indigo/rose/pink/text-green-400 class names', () => {
    const { container } = render(
      <HubAdvancedFilters
        activeAdvancedFilter={null}
        filterMetas={allFilterMetas()}
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
