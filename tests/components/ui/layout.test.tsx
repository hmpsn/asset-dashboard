import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { Row } from '../../../src/components/ui/layout/Row';
import { Stack } from '../../../src/components/ui/layout/Stack';
import { Column } from '../../../src/components/ui/layout/Column';
import { Grid } from '../../../src/components/ui/layout/Grid';
import { Divider } from '../../../src/components/ui/layout/Divider';

// ─── Row ──────────────────────────────────────────────────────────────────────

describe('Row', () => {
  it('renders children', () => {
    const { getByText } = render(<Row>hello</Row>);
    expect(getByText('hello')).toBeInTheDocument();
  });

  it('applies flex flex-row classes', () => {
    const { container } = render(<Row />);
    expect(container.firstElementChild?.className).toContain('flex');
    expect(container.firstElementChild?.className).toContain('flex-row');
  });

  it('defaults to items-center alignment', () => {
    const { container } = render(<Row />);
    expect(container.firstElementChild?.className).toContain('items-center');
  });

  it('applies correct gap class for each size', () => {
    const cases: [string, string][] = [
      ['xs', 'gap-1'],
      ['sm', 'gap-2'],
      ['md', 'gap-3'],
      ['lg', 'gap-4'],
      ['xl', 'gap-6'],
    ];
    for (const [gap, expected] of cases) {
      const { container, unmount } = render(<Row gap={gap as 'xs'} />);
      expect(container.firstElementChild?.className).toContain(expected);
      unmount();
    }
  });

  it('accepts and merges className', () => {
    const { container } = render(<Row className="custom-cls" />);
    expect(container.firstElementChild?.className).toContain('custom-cls');
    expect(container.firstElementChild?.className).toContain('flex-row');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Row ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('applies align variants', () => {
    const cases: [string, string][] = [
      ['start', 'items-start'],
      ['end', 'items-end'],
      ['baseline', 'items-baseline'],
    ];
    for (const [align, expected] of cases) {
      const { container, unmount } = render(<Row align={align as 'start'} />);
      expect(container.firstElementChild?.className).toContain(expected);
      unmount();
    }
  });

  it('applies justify variants', () => {
    const cases: [string, string][] = [
      ['start', 'justify-start'],
      ['center', 'justify-center'],
      ['end', 'justify-end'],
      ['between', 'justify-between'],
      ['around', 'justify-around'],
    ];
    for (const [justify, expected] of cases) {
      const { container, unmount } = render(<Row justify={justify as 'start'} />);
      expect(container.firstElementChild?.className).toContain(expected);
      unmount();
    }
  });

  it('applies flex-wrap when wrap=true', () => {
    const { container } = render(<Row wrap={true} />);
    expect(container.firstElementChild?.className).toContain('flex-wrap');
  });

  it('applies flex-nowrap when wrap=false', () => {
    const { container } = render(<Row wrap={false} />);
    expect(container.firstElementChild?.className).toContain('flex-nowrap');
  });

  it('does not add wrap class when wrap prop is omitted', () => {
    const { container } = render(<Row />);
    expect(container.firstElementChild?.className).not.toContain('flex-wrap');
    expect(container.firstElementChild?.className).not.toContain('flex-nowrap');
  });
});

// ─── Stack ────────────────────────────────────────────────────────────────────

describe('Stack', () => {
  it('renders children', () => {
    const { getByText } = render(<Stack>content</Stack>);
    expect(getByText('content')).toBeInTheDocument();
  });

  it('defaults to flex-col direction', () => {
    const { container } = render(<Stack />);
    expect(container.firstElementChild?.className).toContain('flex');
    expect(container.firstElementChild?.className).toContain('flex-col');
  });

  it('applies flex-row when dir="row"', () => {
    const { container } = render(<Stack dir="row" />);
    expect(container.firstElementChild?.className).toContain('flex-row');
    expect(container.firstElementChild?.className).not.toContain('flex-col');
  });

  it('applies correct gap class', () => {
    const { container } = render(<Stack gap="lg" />);
    expect(container.firstElementChild?.className).toContain('gap-4');
  });

  it('applies align variants', () => {
    const cases: [string, string][] = [
      ['start', 'items-start'],
      ['center', 'items-center'],
      ['end', 'items-end'],
      ['stretch', 'items-stretch'],
    ];
    for (const [align, expected] of cases) {
      const { container, unmount } = render(<Stack align={align as 'start'} />);
      expect(container.firstElementChild?.className).toContain(expected);
      unmount();
    }
  });

  it('accepts and merges className', () => {
    const { container } = render(<Stack className="extra" />);
    expect(container.firstElementChild?.className).toContain('extra');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Stack ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

// ─── Column ───────────────────────────────────────────────────────────────────

describe('Column', () => {
  it('renders children', () => {
    const { getByText } = render(<Column>col content</Column>);
    expect(getByText('col content')).toBeInTheDocument();
  });

  it('is a flex-col container', () => {
    const { container } = render(<Column />);
    expect(container.firstElementChild?.className).toContain('flex');
    expect(container.firstElementChild?.className).toContain('flex-col');
  });

  it('never produces flex-row', () => {
    const { container } = render(<Column />);
    expect(container.firstElementChild?.className).not.toContain('flex-row');
  });

  it('applies gap class', () => {
    const { container } = render(<Column gap="xl" />);
    expect(container.firstElementChild?.className).toContain('gap-6');
  });

  it('accepts and merges className', () => {
    const { container } = render(<Column className="col-custom" />);
    expect(container.firstElementChild?.className).toContain('col-custom');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Column ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

// ─── Grid ─────────────────────────────────────────────────────────────────────

describe('Grid', () => {
  it('renders children', () => {
    const { getByText } = render(<Grid cols={{ sm: 2 }}>item</Grid>);
    expect(getByText('item')).toBeInTheDocument();
  });

  it('applies base grid class', () => {
    const { container } = render(<Grid cols={{ sm: 3 }} />);
    expect(container.firstElementChild?.className).toContain('grid');
  });

  it('emits grid-cols-N for sm breakpoint', () => {
    const { container } = render(<Grid cols={{ sm: 1 }} />);
    expect(container.firstElementChild?.className).toContain('grid-cols-1');
    expect(container.firstElementChild?.className).toContain('sm:grid-cols-1');
  });

  it('emits responsive breakpoint classes for md and lg', () => {
    const { container } = render(<Grid cols={{ sm: 1, md: 2, lg: 3 }} />);
    const cls = container.firstElementChild?.className ?? '';
    expect(cls).toContain('md:grid-cols-2');
    expect(cls).toContain('lg:grid-cols-3');
  });

  it('emits xl breakpoint class', () => {
    const { container } = render(<Grid cols={{ xl: 4 }} />);
    expect(container.firstElementChild?.className).toContain('xl:grid-cols-4');
  });

  it('applies gap class', () => {
    const { container } = render(<Grid cols={{ md: 2 }} gap="md" />);
    expect(container.firstElementChild?.className).toContain('gap-3');
  });

  it('accepts and merges className', () => {
    const { container } = render(<Grid cols={{ sm: 2 }} className="grid-custom" />);
    expect(container.firstElementChild?.className).toContain('grid-custom');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Grid cols={{ md: 3 }} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  // Static map verification — ensures class strings are literal (Tailwind-scannable)
  // rather than dynamically interpolated (which Tailwind v4 would purge in production).
  it('produces literal md:grid-cols-7 string for Tailwind scanner', () => {
    const { container } = render(<Grid cols={{ md: 7 }} />);
    const cls = container.firstElementChild?.className ?? '';
    expect(cls).toContain('md:grid-cols-7');
  });

  it('produces literal xl:grid-cols-5 string for Tailwind scanner', () => {
    const { container } = render(<Grid cols={{ xl: 5 }} />);
    const cls = container.firstElementChild?.className ?? '';
    expect(cls).toContain('xl:grid-cols-5');
  });

  it('produces literal sm:grid-cols-6 and lg:grid-cols-12 for Tailwind scanner', () => {
    const { container } = render(<Grid cols={{ sm: 6, lg: 12 }} />);
    const cls = container.firstElementChild?.className ?? '';
    expect(cls).toContain('sm:grid-cols-6');
    expect(cls).toContain('lg:grid-cols-12');
  });

  it('produces literal base grid-cols-N from first defined breakpoint', () => {
    const { container } = render(<Grid cols={{ md: 3 }} />);
    const cls = container.firstElementChild?.className ?? '';
    // Base (unscoped) class emitted for viewports below the first breakpoint
    expect(cls).toContain('grid-cols-3');
    expect(cls).toContain('md:grid-cols-3');
  });
});

// ─── Divider ──────────────────────────────────────────────────────────────────

describe('Divider', () => {
  it('renders as a separator element', () => {
    const { container } = render(<Divider />);
    expect(container.firstElementChild?.getAttribute('role')).toBe('separator');
  });

  it('horizontal (default) has border-b and w-full', () => {
    const { container } = render(<Divider />);
    const cls = container.firstElementChild?.className ?? '';
    expect(cls).toContain('border-b');
    expect(cls).toContain('w-full');
  });

  it('vertical has border-r and h-full', () => {
    const { container } = render(<Divider orientation="vertical" />);
    const cls = container.firstElementChild?.className ?? '';
    expect(cls).toContain('border-r');
    expect(cls).toContain('h-full');
  });

  it('vertical does not have border-b', () => {
    const { container } = render(<Divider orientation="vertical" />);
    expect(container.firstElementChild?.className).not.toContain('border-b');
  });

  it('horizontal does not have border-r', () => {
    const { container } = render(<Divider />);
    expect(container.firstElementChild?.className).not.toContain('border-r');
  });

  it('uses --brand-border CSS variable for border color', () => {
    const { container } = render(<Divider />);
    expect(container.firstElementChild?.className).toContain('border-[var(--brand-border)]');
  });

  it('accepts and merges className', () => {
    const { container } = render(<Divider className="my-4" />);
    expect(container.firstElementChild?.className).toContain('my-4');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Divider ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('sets aria-orientation for horizontal', () => {
    const { container } = render(<Divider orientation="horizontal" />);
    expect(container.firstElementChild?.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('sets aria-orientation for vertical', () => {
    const { container } = render(<Divider orientation="vertical" />);
    expect(container.firstElementChild?.getAttribute('aria-orientation')).toBe('vertical');
  });
});
