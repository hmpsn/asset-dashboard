/**
 * Component tests for the canonical KeywordTable primitive (Wave 2, Task T3).
 *
 * Written FIRST (red → green TDD). These assertions fail until KeywordTable is
 * built in src/components/shared/RankTable.tsx and consumes the shared T1
 * positionColor + T2 fmtNum/kdColor authorities.
 *
 * Contract under test (the 9 absorption gaps + change-sign resolution):
 *  1. generic/superset row type renders
 *  2. renderActions slot
 *  3. variant sub-row slot
 *  4. selection checkbox column
 *  5. flag-gated local-seo column (opt-in)
 *  6. sort headers
 *  7. per-row expand slot
 *  8. EmptyState (not null) + skeleton
 *  9. density/compact variant
 *  + change-sign conflict resolved via changeSign prop (both conventions)
 *  + shared authorities consumed (positionColor / fmtNum / kdColor)
 *  + the existing RankTrackingSection wrapper still renders identically
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Trophy } from 'lucide-react';

import {
  KeywordTable,
  RankChange,
  RankTable,
  RankTrackingSection,
  type KeywordTableRow,
} from '../../src/components/shared/RankTable';
import { positionColor } from '../../src/components/ui/constants';
import { fmtNum } from '../../src/utils/formatNumbers';
import { kdColor } from '../../src/components/page-intelligence/pageIntelligenceDisplay';

function makeRow(overrides: Partial<KeywordTableRow> = {}): KeywordTableRow {
  return { query: 'seo tips', position: 5, change: 2, clicks: 120, impressions: 2000, ...overrides };
}

// ══════════════════════════════════════════════════════════════════════════════
// Gap 1 + shared authorities: row renders position via positionColor, volume via
// fmtNum, KD via kdColor
// ══════════════════════════════════════════════════════════════════════════════

describe('KeywordTable — row rendering via shared authorities', () => {
  it('renders the keyword query', () => {
    render(<KeywordTable rows={[makeRow({ query: 'local seo' })]} />);
    expect(screen.getByText('local seo')).toBeInTheDocument();
  });

  it('paints position with the shared positionColor authority (emerald at ≤10)', () => {
    render(<KeywordTable rows={[makeRow({ position: 5 })]} />);
    const cell = screen.getByText('#5');
    // Shared T1 authority — emerald (text-accent-success), NOT teal, NOT raw emerald-400/80.
    expect(cell.className).toContain(positionColor(5));
    expect(cell.className).toContain('text-accent-success');
  });

  it('formats volume with the shared fmtNum authority when the volume column is on', () => {
    render(
      <KeywordTable rows={[makeRow({ volume: 12000 })]} columns={['volume']} />,
    );
    // fmtNum(12000) === '12.0K'; the volume column appends the canonical '/mo' suffix.
    expect(screen.getByText(`${fmtNum(12000)}/mo`)).toBeInTheDocument();
    expect(screen.getByText('12.0K/mo')).toBeInTheDocument();
  });

  it('paints KD with the shared kdColor authority when the difficulty column is on', () => {
    render(
      <KeywordTable rows={[makeRow({ difficulty: 75 })]} columns={['difficulty']} />,
    );
    const kdCell = screen.getByText(/KD 75/);
    // kdColor(75) === 'text-accent-danger' (band >70)
    expect(kdCell.className).toContain(kdColor(75));
    expect(kdCell.className).toContain('text-accent-danger');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Gap 2: renderActions slot
// ══════════════════════════════════════════════════════════════════════════════

describe('KeywordTable — renderActions slot', () => {
  it('renders the action slot content per row', () => {
    render(
      <KeywordTable
        rows={[makeRow({ query: 'pinme' })]}
        renderActions={(r) => <button>act-{r.query}</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'act-pinme' })).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// change-sign resolution — BOTH conventions
// ══════════════════════════════════════════════════════════════════════════════

describe('KeywordTable — changeSign resolution', () => {
  it('higherIsBetter (default): positive change is success-colored, up arrow', () => {
    render(<KeywordTable rows={[makeRow({ change: 3 })]} changeSign="higherIsBetter" />);
    const el = screen.getByText(/3/, { selector: 'span' });
    expect(el.textContent).toContain('↑');
    expect(el.className).toContain('text-emerald-400/80');
  });

  it('lowerIsBetter (RankTracker convention): negative change is success-colored, up arrow', () => {
    // change = -3 means rank improved (moved toward #1) → good under lowerIsBetter.
    render(<KeywordTable rows={[makeRow({ change: -3 })]} changeSign="lowerIsBetter" />);
    const el = screen.getByText(/3/, { selector: 'span' });
    expect(el.textContent).toContain('↑');
    expect(el.className).toContain('text-emerald-400/80');
  });

  it('lowerIsBetter: positive change (rank fell) is danger-colored, down arrow', () => {
    render(<KeywordTable rows={[makeRow({ change: 4 })]} changeSign="lowerIsBetter" />);
    const el = screen.getByText(/4/, { selector: 'span' });
    expect(el.textContent).toContain('↓');
    expect(el.className).toContain('text-red-400/80');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Gap 4: selection checkbox column
// ══════════════════════════════════════════════════════════════════════════════

describe('KeywordTable — selection checkbox column', () => {
  it('renders a checkbox per row when selection is enabled, and fires onToggle', () => {
    const onToggle = vi.fn();
    render(
      <KeywordTable
        rows={[makeRow({ query: 'pick-me' })]}
        selection={{ selected: new Set<string>(), onToggle, rowId: (r) => r.query }}
      />,
    );
    const checkbox = screen.getByRole('checkbox', { name: /pick-me/i });
    expect(checkbox).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith('pick-me');
  });

  it('does NOT render a checkbox column when selection is omitted', () => {
    render(<KeywordTable rows={[makeRow()]} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Gap 3: variant sub-row slot
// ══════════════════════════════════════════════════════════════════════════════

describe('KeywordTable — variant sub-row slot', () => {
  it('renders a variant sub-row per variant when renderVariant is supplied', () => {
    const row = makeRow({
      query: 'parent kw',
      variants: [{ query: 'child variant a' }, { query: 'child variant b' }],
    });
    render(
      <KeywordTable
        rows={[row]}
        renderVariant={(v) => <span>variant:{(v as { query: string }).query}</span>}
      />,
    );
    expect(screen.getByText('variant:child variant a')).toBeInTheDocument();
    expect(screen.getByText('variant:child variant b')).toBeInTheDocument();
  });

  it('does not render variant rows when renderVariant is omitted', () => {
    const row = makeRow({ query: 'parent kw', variants: [{ query: 'hidden variant' }] });
    render(<KeywordTable rows={[row]} />);
    expect(screen.queryByText(/hidden variant/)).not.toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Gap 5: flag-gated local-seo column (opt-in)
// ══════════════════════════════════════════════════════════════════════════════

describe('KeywordTable — flag-gated local-seo column', () => {
  it('renders the local-seo column only when showLocalSeo is true', () => {
    render(
      <KeywordTable
        rows={[makeRow({ localSeoLabel: 'Visible locally' })]}
        showLocalSeo
      />,
    );
    expect(screen.getByText('Local')).toBeInTheDocument(); // header
    expect(screen.getByText('Visible locally')).toBeInTheDocument();
  });

  it('hides the local-seo column when showLocalSeo is false/absent (flag OFF)', () => {
    render(<KeywordTable rows={[makeRow({ localSeoLabel: 'Visible locally' })]} />);
    expect(screen.queryByText('Local')).not.toBeInTheDocument();
    expect(screen.queryByText('Visible locally')).not.toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Gap 6: sort headers
// ══════════════════════════════════════════════════════════════════════════════

describe('KeywordTable — sort headers', () => {
  it('renders clickable sort headers and fires onSort with the column key', () => {
    const onSort = vi.fn();
    render(
      <KeywordTable
        rows={[makeRow()]}
        sort={{ key: 'position', direction: 'asc', onSort }}
      />,
    );
    const header = screen.getByRole('button', { name: /position/i });
    fireEvent.click(header);
    expect(onSort).toHaveBeenCalledWith('position');
  });

  it('renders plain (non-button) headers when sort is omitted', () => {
    render(<KeywordTable rows={[makeRow()]} />);
    expect(screen.queryByRole('button', { name: /^position$/i })).not.toBeInTheDocument();
    expect(screen.getByText('Position')).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Gap 7: per-row expand slot
// ══════════════════════════════════════════════════════════════════════════════

describe('KeywordTable — per-row expand slot', () => {
  it('renders expanded detail content for rows reported expanded', () => {
    const row = makeRow({ query: 'expandable' });
    render(
      <KeywordTable
        rows={[row]}
        isRowExpanded={() => true}
        renderExpanded={(r) => <div>expanded-detail-{r.query}</div>}
      />,
    );
    expect(screen.getByText('expanded-detail-expandable')).toBeInTheDocument();
  });

  it('does NOT render expanded content when isRowExpanded returns false', () => {
    const row = makeRow({ query: 'collapsed' });
    render(
      <KeywordTable
        rows={[row]}
        isRowExpanded={() => false}
        renderExpanded={(r) => <div>expanded-detail-{r.query}</div>}
      />,
    );
    expect(screen.queryByText(/expanded-detail/)).not.toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Gap 8: EmptyState (not null) + skeleton
// ══════════════════════════════════════════════════════════════════════════════

describe('KeywordTable — empty + loading states', () => {
  it('renders an EmptyState (NOT null) when rows are empty', () => {
    const { container } = render(
      <KeywordTable rows={[]} emptyState={{ icon: Trophy, title: 'No keywords yet' }} />,
    );
    expect(screen.getByText('No keywords yet')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
  });

  it('renders a default EmptyState when rows are empty and no override given', () => {
    render(<KeywordTable rows={[]} />);
    // default title — fixes RankTable's old null-return bug
    expect(screen.getByText(/no keywords/i)).toBeInTheDocument();
  });

  it('renders a skeleton (not the table) when loading', () => {
    const { container } = render(<KeywordTable rows={[]} loading />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Gap 9: density / compact variant
// ══════════════════════════════════════════════════════════════════════════════

describe('KeywordTable — density variant', () => {
  it('applies compact density classes to body rows when density="compact"', () => {
    const { container } = render(
      <KeywordTable rows={[makeRow()]} density="compact" />,
    );
    const queryCell = screen.getByText('seo tips').closest('td');
    expect(queryCell?.className).toContain('py-1');
    // comfortable uses py-1.5; compact must be tighter
    expect(queryCell?.className).not.toContain('py-1.5');
    expect(container.querySelector('table')).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 4 P0 (Gap 10): generic custom-column slot — absorbs the KCC bespoke columns
// (Status / Local / Demand / Rank-KD / Assignment / Next) and the RankTracker
// position/change cells WITHOUT a built-in KeywordColumnKey. Additive: every
// existing consumer (no customColumns) renders byte-identical.
// ══════════════════════════════════════════════════════════════════════════════

describe('KeywordTable — generic custom-column slot', () => {
  it('renders a custom header + per-row cell for each custom column', () => {
    render(
      <KeywordTable
        rows={[makeRow({ query: 'kw-a' })]}
        columns={[]}
        customColumns={[
          { key: 'status', header: 'Status', render: (r) => <span>status:{r.query}</span> },
          { key: 'assignment', header: 'Assignment', render: () => <span>mapped</span> },
        ]}
      />,
    );
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Assignment')).toBeInTheDocument();
    expect(screen.getByText('status:kw-a')).toBeInTheDocument();
    expect(screen.getByText('mapped')).toBeInTheDocument();
  });

  it('custom columns participate in sort — clicking a custom header fires onSort with its sortKey', () => {
    const onSort = vi.fn();
    render(
      <KeywordTable
        rows={[makeRow()]}
        columns={[]}
        sort={{ key: 'keyword', direction: 'asc', onSort }}
        customColumns={[
          { key: 'demand', header: 'Demand', sortKey: 'demand', render: () => <span>700</span> },
        ]}
      />,
    );
    const header = screen.getByRole('button', { name: /demand/i });
    fireEvent.click(header);
    expect(onSort).toHaveBeenCalledWith('demand');
  });

  it('custom columns without a sortKey render a plain (non-button) header even when sort is on', () => {
    const onSort = vi.fn();
    render(
      <KeywordTable
        rows={[makeRow()]}
        columns={[]}
        sort={{ key: 'keyword', direction: 'asc', onSort }}
        customColumns={[{ key: 'next', header: 'Next', render: () => <span>actions</span> }]}
      />,
    );
    // No sortKey → not a sortable button, just a label.
    expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('counts custom columns in totalCols so expanded/variant rows still span the full width', () => {
    const row = makeRow({ query: 'expand-me' });
    const { container } = render(
      <KeywordTable
        rows={[row]}
        columns={['position', 'change']}
        selection={{ selected: new Set<string>(), onToggle: vi.fn(), rowId: (r) => r.query }}
        showLocalSeo
        renderActions={() => <button>act</button>}
        customColumns={[
          { key: 'status', header: 'Status', render: () => <span>S</span> },
          { key: 'assignment', header: 'Assignment', render: () => <span>A</span> },
        ]}
        isRowExpanded={() => true}
        renderExpanded={() => <div>expanded</div>}
      />,
    );
    // totalCols = 1 keyword + 2 data + 2 custom + 1 localSeo + 1 selection + 1 actions = 8
    const expandedCell = screen.getByText('expanded').closest('td');
    expect(expandedCell?.getAttribute('colSpan')).toBe('8');
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('renders custom columns between the keyword cell and the built-in data columns', () => {
    const { container } = render(
      <KeywordTable
        rows={[makeRow({ query: 'kw' })]}
        columns={['position']}
        customColumns={[{ key: 'status', header: 'Status', render: () => <span>S-cell</span> }]}
      />,
    );
    const headerCells = [...(container.querySelectorAll('thead th') ?? [])].map((th) => th.textContent);
    // order: Keyword, Status (custom), Position (built-in)
    expect(headerCells).toEqual(['Keyword', 'Status', 'Position']);
  });

  it('is fully absent when customColumns is omitted (byte-identical existing consumers)', () => {
    const { container } = render(<KeywordTable rows={[makeRow()]} columns={['position']} />);
    const headerCells = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headerCells).toEqual(['Keyword', 'Position']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RankChange standalone — byte-identical sign convention (change>0 = good)
// ══════════════════════════════════════════════════════════════════════════════

describe('RankChange — unchanged sign convention (change>0 = good)', () => {
  it('renders an em-dash for undefined change', () => {
    render(<RankChange change={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders an em-dash for zero change', () => {
    render(<RankChange change={0} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders ↑ and emerald for positive change', () => {
    render(<RankChange change={5} />);
    const el = screen.getByText(/↑5/);
    expect(el.className).toContain('text-emerald-400/80');
  });

  it('renders ↓ and red for negative change', () => {
    render(<RankChange change={-5} />);
    const el = screen.getByText(/↓5/);
    expect(el.className).toContain('text-red-400/80');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Byte-identical wrapper contract: RankTable + RankTrackingSection
// ══════════════════════════════════════════════════════════════════════════════

describe('RankTable wrapper — byte-identical to legacy', () => {
  const ranks = [
    { query: 'alpha', position: 2, change: 3, clicks: 50, impressions: 1200 },
    { query: 'beta', position: 14, change: -2, clicks: 10, impressions: 400 },
  ];

  it('renders the legacy column headers', () => {
    render(<RankTable ranks={ranks} />);
    expect(screen.getByText('Keyword')).toBeInTheDocument();
    expect(screen.getByText('Position')).toBeInTheDocument();
    expect(screen.getByText('Change')).toBeInTheDocument();
    expect(screen.getByText('Clicks')).toBeInTheDocument();
  });

  it('renders blue-colored clicks (data hue) exactly like legacy', () => {
    render(<RankTable ranks={ranks} />);
    const clicksCell = screen.getByText('50').closest('td');
    expect(clicksCell?.className).toContain('text-blue-400');
  });

  it('shows impressions column only when showImpressions is set', () => {
    const { rerender } = render(<RankTable ranks={ranks} />);
    expect(screen.queryByText('Impressions')).not.toBeInTheDocument();
    rerender(<RankTable ranks={ranks} showImpressions />);
    expect(screen.getByText('Impressions')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
  });

  it('renders an action column when renderActions is provided', () => {
    render(<RankTable ranks={ranks} renderActions={(r) => <button>x-{r.query}</button>} />);
    expect(screen.getByRole('button', { name: 'x-alpha' })).toBeInTheDocument();
  });
});

describe('RankTrackingSection wrapper — still renders identically', () => {
  const rankHistory = [
    { date: '2024-01-01', positions: { alpha: 5, beta: 12 } },
    { date: '2024-01-08', positions: { alpha: 3, beta: 10 } },
  ];
  const latestRanks = [
    { query: 'alpha', position: 3, change: 2, clicks: 80, impressions: 1500, ctr: 0.05 },
  ];

  it('renders the section title and snapshot count', () => {
    render(<RankTrackingSection rankHistory={rankHistory} latestRanks={latestRanks} />);
    expect(screen.getByText('Keyword Rank Tracking')).toBeInTheDocument();
    expect(screen.getByText('2 snapshots')).toBeInTheDocument();
  });

  it('renders the latest-ranks table inside the section', () => {
    const { container } = render(
      <RankTrackingSection rankHistory={rankHistory} latestRanks={latestRanks} />,
    );
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    // 'alpha' appears in both the chart legend and the table; scope to the table.
    expect(within(table as HTMLElement).getByText('alpha')).toBeInTheDocument();
    // clicks rendered blue (data hue), em-dash never used here (change=2 → ↑2)
    expect(within(table as HTMLElement).getByText(/↑2/)).toBeInTheDocument();
  });

  it('returns null when there is neither history nor latest ranks (unchanged guard)', () => {
    const { container } = render(<RankTrackingSection rankHistory={[]} latestRanks={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
