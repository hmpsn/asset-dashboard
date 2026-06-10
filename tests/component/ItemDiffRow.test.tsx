/**
 * Component tests for ISSUE 1b — ItemDiffRow `expandable` prop.
 *
 * Asserts:
 *  - default (no `expandable`) keeps the EXACT `line-clamp-2` clamp on Current/Proposed values
 *    (no-regression guard for the existing modal caller) and shows NO expand toggle;
 *  - `expandable` adds a "Show full ↓ / Show less ↑" toggle that swaps the clamp for a scrollable
 *    monospace block.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ItemDiffRow } from '../../src/components/client/decision-renderers';

const baseProps = {
  label: 'Home',
  field: 'schema',
  currentValue: 'current value',
  proposedValue: 'proposed value',
  flagged: false,
  onFlag: vi.fn(),
  onUnflag: vi.fn(),
};

describe('ItemDiffRow expandable prop', () => {
  it('default → Current/Proposed keep line-clamp-2 and there is NO expand toggle (regression guard)', () => {
    render(<ItemDiffRow {...baseProps} />);
    // The existing modal caller behavior: 2-line clamp on both values.
    const current = screen.getByText('current value');
    const proposed = screen.getByText('proposed value');
    expect(current.className).toContain('line-clamp-2');
    expect(proposed.className).toContain('line-clamp-2');
    expect(current.className).not.toContain('overflow-y-auto');
    // No expand toggle when not expandable.
    expect(screen.queryByRole('button', { name: 'Show full ↓' })).not.toBeInTheDocument();
  });

  it('expandable → renders a Show full toggle; collapsed values still clamp', () => {
    render(<ItemDiffRow {...baseProps} expandable />);
    expect(screen.getByRole('button', { name: 'Show full ↓' })).toBeInTheDocument();
    // Collapsed (default expanded=false) still clamps.
    expect(screen.getByText('current value').className).toContain('line-clamp-2');
  });

  it('expandable → clicking Show full swaps the clamp for a scrollable monospace block', () => {
    render(<ItemDiffRow {...baseProps} expandable />);
    fireEvent.click(screen.getByRole('button', { name: 'Show full ↓' }));
    expect(screen.getByRole('button', { name: 'Show less ↑' })).toBeInTheDocument();
    const proposed = screen.getByText('proposed value');
    expect(proposed.className).toContain('overflow-y-auto');
    expect(proposed.className).toContain('max-h-[200px]');
    expect(proposed.className).toContain('font-mono');
    expect(proposed.className).not.toContain('line-clamp-2');
  });
});

describe('ItemDiffRow onEdit prop (item 2 — edit before approve)', () => {
  const seoTitleProps = {
    label: 'Home',
    field: 'seoTitle',
    currentValue: 'Old title',
    proposedValue: 'Proposed title',
    flagged: false,
    onFlag: vi.fn(),
    onUnflag: vi.fn(),
  };

  it('no onEdit → NO Edit affordance (regression guard for read-only callers)', () => {
    render(<ItemDiffRow {...seoTitleProps} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    // The proposed value renders read-only.
    expect(screen.getByText('Proposed title')).toBeInTheDocument();
  });

  it('onEdit → Edit affordance opens an input seeded with the proposed value; Save edit reports it', () => {
    const onEdit = vi.fn();
    render(<ItemDiffRow {...seoTitleProps} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByLabelText('Edit proposed SEO Title') as HTMLInputElement;
    // Seeded with the current proposed value.
    expect(input.value).toBe('Proposed title');

    fireEvent.change(input, { target: { value: 'Client-fixed title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
    expect(onEdit).toHaveBeenCalledWith('Client-fixed title');
  });

  it('editedValue → the Proposed cell shows the edited value + an "edited" marker', () => {
    render(<ItemDiffRow {...seoTitleProps} onEdit={vi.fn()} editedValue="My edited title" />);
    expect(screen.getByText('My edited title')).toBeInTheDocument();
    expect(screen.queryByText('Proposed title')).not.toBeInTheDocument();
    expect(screen.getByText('· edited')).toBeInTheDocument();
  });

  it('seoDescription → the editor uses a multi-line textarea', () => {
    render(
      <ItemDiffRow
        {...seoTitleProps}
        field="seoDescription"
        proposedValue="A longer meta description for the page."
        onEdit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByLabelText('Edit proposed Meta Description');
    expect(editor.tagName).toBe('TEXTAREA');
  });

  it('readOnly → suppresses the Edit affordance even when onEdit is provided (publish mode)', () => {
    render(<ItemDiffRow {...seoTitleProps} onEdit={vi.fn()} readOnly />);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});
