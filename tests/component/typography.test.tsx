import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { Heading } from '../../src/components/ui/typography/Heading';
import { Stat } from '../../src/components/ui/typography/Stat';
import { BodyText } from '../../src/components/ui/typography/BodyText';
import { Caption } from '../../src/components/ui/typography/Caption';
import { Label } from '../../src/components/ui/typography/Label';
import { Mono } from '../../src/components/ui/typography/Mono';

// ─── Heading ──────────────────────────────────────────────────────────────────

describe('Heading', () => {
  it('renders .t-h1 class for level 1', () => {
    const { container } = render(<Heading level={1}>Title</Heading>);
    expect(container.firstElementChild!.className).toContain('t-h1');
  });

  it('renders .t-h2 class for level 2', () => {
    const { container } = render(<Heading level={2}>Section</Heading>);
    expect(container.firstElementChild!.className).toContain('t-h2');
  });

  it('renders .t-page class for level 3', () => {
    const { container } = render(<Heading level={3}>Sub-header</Heading>);
    expect(container.firstElementChild!.className).toContain('t-page');
  });

  it('defaults to h1/h2/h3 tag matching level', () => {
    const { container: c1 } = render(<Heading level={1}>H1</Heading>);
    expect(c1.querySelector('h1')).not.toBeNull();

    const { container: c2 } = render(<Heading level={2}>H2</Heading>);
    expect(c2.querySelector('h2')).not.toBeNull();

    const { container: c3 } = render(<Heading level={3}>H3</Heading>);
    expect(c3.querySelector('h3')).not.toBeNull();
  });

  it('overrides tag with as="div"', () => {
    const { container } = render(<Heading level={1} as="div">Div heading</Heading>);
    expect(container.querySelector('div')).not.toBeNull();
    expect(container.querySelector('h1')).toBeNull();
  });

  it('accepts and appends extra className', () => {
    const { container } = render(<Heading level={1} className="extra-class">X</Heading>);
    expect(container.firstElementChild!.className).toContain('t-h1');
    expect(container.firstElementChild!.className).toContain('extra-class');
  });

  it('passes children through', () => {
    const { getByText } = render(<Heading level={2}>Hello world</Heading>);
    expect(getByText('Hello world')).toBeTruthy();
  });

  it('forwards ref to the DOM element', () => {
    const ref = React.createRef<HTMLElement>();
    const { container } = render(<Heading level={1} ref={ref}>Ref test</Heading>);
    expect(ref.current).toBe(container.querySelector('h1'));
  });
});

// ─── Stat ─────────────────────────────────────────────────────────────────────

describe('Stat', () => {
  it('renders .t-stat-lg for size="hero"', () => {
    const { container } = render(<Stat size="hero">42,000</Stat>);
    expect(container.firstElementChild!.className).toContain('t-stat-lg');
  });

  it('renders .t-stat for size="default" (default prop)', () => {
    const { container } = render(<Stat>42</Stat>);
    expect(container.firstElementChild!.className).toContain('t-stat');
  });

  it('renders .t-stat-sm for size="sm"', () => {
    const { container } = render(<Stat size="sm">7</Stat>);
    expect(container.firstElementChild!.className).toContain('t-stat-sm');
  });

  it('accepts and appends extra className', () => {
    const { container } = render(<Stat size="hero" className="text-teal-400">9</Stat>);
    expect(container.firstElementChild!.className).toContain('t-stat-lg');
    expect(container.firstElementChild!.className).toContain('text-teal-400');
  });

  it('passes children through', () => {
    const { getByText } = render(<Stat>1,234</Stat>);
    expect(getByText('1,234')).toBeTruthy();
  });

  it('forwards ref to the div element', () => {
    const ref = React.createRef<HTMLDivElement>();
    const { container } = render(<Stat ref={ref}>0</Stat>);
    expect(ref.current).toBe(container.querySelector('div'));
  });
});

// ─── BodyText ─────────────────────────────────────────────────────────────────

describe('BodyText', () => {
  it('renders .t-body class', () => {
    const { container } = render(<BodyText>Some text</BodyText>);
    expect(container.firstElementChild!.className).toContain('t-body');
  });

  it('applies default tone (--brand-text)', () => {
    const { container } = render(<BodyText>Default</BodyText>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.color).toBe('var(--brand-text)');
  });

  it('applies muted tone (--brand-text-muted)', () => {
    const { container } = render(<BodyText tone="muted">Muted</BodyText>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.color).toBe('var(--brand-text-muted)');
  });

  it('applies dim tone (--brand-text-dim)', () => {
    const { container } = render(<BodyText tone="dim">Dim</BodyText>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.color).toBe('var(--brand-text-dim)');
  });

  it('accepts and appends extra className', () => {
    const { container } = render(<BodyText className="max-w-prose">Text</BodyText>);
    expect(container.firstElementChild!.className).toContain('t-body');
    expect(container.firstElementChild!.className).toContain('max-w-prose');
  });

  it('passes children through', () => {
    const { getByText } = render(<BodyText>Paragraph text here</BodyText>);
    expect(getByText('Paragraph text here')).toBeTruthy();
  });

  it('forwards ref to the p element', () => {
    const ref = React.createRef<HTMLParagraphElement>();
    const { container } = render(<BodyText ref={ref}>Ref</BodyText>);
    expect(ref.current).toBe(container.querySelector('p'));
  });
});

// ─── Caption ──────────────────────────────────────────────────────────────────

describe('Caption', () => {
  it('renders .t-caption for default size', () => {
    const { container } = render(<Caption>2m ago</Caption>);
    expect(container.firstElementChild!.className).toContain('t-caption');
  });

  it('renders .t-caption-sm for size="sm"', () => {
    const { container } = render(<Caption size="sm">tiny</Caption>);
    expect(container.firstElementChild!.className).toContain('t-caption-sm');
  });

  it('accepts and appends extra className', () => {
    const { container } = render(<Caption className="text-emerald-400">Done</Caption>);
    expect(container.firstElementChild!.className).toContain('t-caption');
    expect(container.firstElementChild!.className).toContain('text-emerald-400');
  });

  it('passes children through', () => {
    const { getByText } = render(<Caption>Last synced 5m ago</Caption>);
    expect(getByText('Last synced 5m ago')).toBeTruthy();
  });

  it('forwards ref to the span element', () => {
    const ref = React.createRef<HTMLSpanElement>();
    const { container } = render(<Caption ref={ref}>Ref</Caption>);
    expect(ref.current).toBe(container.querySelector('span'));
  });
});

// ─── Label ────────────────────────────────────────────────────────────────────

describe('Label', () => {
  it('renders .t-label class', () => {
    const { container } = render(<Label>Site health</Label>);
    expect(container.firstElementChild!.className).toContain('t-label');
  });

  it('accepts and appends extra className', () => {
    const { container } = render(<Label className="text-teal-400">Active</Label>);
    expect(container.firstElementChild!.className).toContain('t-label');
    expect(container.firstElementChild!.className).toContain('text-teal-400');
  });

  it('passes children through', () => {
    const { getByText } = render(<Label>Last 28 days</Label>);
    expect(getByText('Last 28 days')).toBeTruthy();
  });

  it('forwards ref to the span element', () => {
    const ref = React.createRef<HTMLSpanElement>();
    const { container } = render(<Label ref={ref}>Ref</Label>);
    expect(ref.current).toBe(container.querySelector('span'));
  });
});

// ─── Mono ─────────────────────────────────────────────────────────────────────

describe('Mono', () => {
  it('renders .t-mono for default size', () => {
    const { container } = render(<Mono>/blog/seo-guide</Mono>);
    expect(container.firstElementChild!.className).toContain('t-mono');
  });

  it('renders .t-micro for size="micro"', () => {
    const { container } = render(<Mono size="micro">APR 12</Mono>);
    expect(container.firstElementChild!.className).toContain('t-micro');
  });

  it('accepts and appends extra className', () => {
    const { container } = render(<Mono className="select-all">ID 3f2a</Mono>);
    expect(container.firstElementChild!.className).toContain('t-mono');
    expect(container.firstElementChild!.className).toContain('select-all');
  });

  it('passes children through', () => {
    const { getByText } = render(<Mono>abc-123</Mono>);
    expect(getByText('abc-123')).toBeTruthy();
  });

  it('forwards ref to the span element', () => {
    const ref = React.createRef<HTMLSpanElement>();
    const { container } = render(<Mono ref={ref}>Ref</Mono>);
    expect(ref.current).toBe(container.querySelector('span'));
  });
});
