import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IntentTag } from '../../../src/components/ui/IntentTag';
import { expectNoA11yViolations } from '../a11y';

describe('IntentTag', () => {
  it('renders commercial with the correct label and amber tone class', () => {
    render(<IntentTag intent="commercial" />);
    const el = screen.getByText('Commercial');
    expect(el.className).toMatch(/amber/);
  });

  it('renders informational with the correct label and blue tone class', () => {
    render(<IntentTag intent="informational" />);
    const el = screen.getByText('Informational');
    expect(el.className).toMatch(/blue/);
  });

  it('renders transactional with the correct label and emerald tone class', () => {
    render(<IntentTag intent="transactional" />);
    const el = screen.getByText('Transactional');
    expect(el.className).toMatch(/emerald/);
  });

  it('renders local with the correct label and orange tone class (never purple)', () => {
    render(<IntentTag intent="local" />);
    const el = screen.getByText('Local');
    expect(el.className).toMatch(/orange/);
    expect(el.className).not.toMatch(/purple/);
  });

  it('renders the abbreviated short form when abbreviate is set', () => {
    render(<IntentTag intent="commercial" abbreviate />);
    expect(screen.getByText('Comm')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<IntentTag intent="commercial" />);
    await expectNoA11yViolations(container);
  }, 15_000);

  it('type-rejects an unknown intent value', () => {
    // @ts-expect-error -- 'bogus' is not a valid KeywordIntent
    const el = <IntentTag intent="bogus" />;
    expect(el).toBeTruthy();
  });
});
