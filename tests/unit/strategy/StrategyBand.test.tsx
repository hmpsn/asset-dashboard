import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrategyBand } from '../../../src/components/strategy/StrategyBand';

describe('StrategyBand', () => {
  it('renders the label and children', () => {
    render(<StrategyBand label="Decide"><div>child-content</div></StrategyBand>);
    expect(screen.getByText('Decide')).toBeInTheDocument();
    expect(screen.getByText('child-content')).toBeInTheDocument();
  });

  it('renders with first=true without throwing', () => {
    render(
      <StrategyBand label="Decide" first>
        <div>first-child</div>
      </StrategyBand>
    );
    expect(screen.getByText('Decide')).toBeInTheDocument();
    expect(screen.getByText('first-child')).toBeInTheDocument();
  });

  it('default (no first prop) includes the top-border container class', () => {
    const { container } = render(
      <StrategyBand label="Act"><div>act-child</div></StrategyBand>
    );
    // The header row div should carry border-t when first is not set
    const headerRow = container.querySelector('.border-t.border-\\[var\\(--brand-border\\)\\].my-6');
    expect(headerRow).not.toBeNull();
  });

  it('first=true omits the top-border/margin from the header row', () => {
    const { container } = render(
      <StrategyBand label="Decide" first><div>decide-child</div></StrategyBand>
    );
    // The outer header row must NOT have my-6/border-t (the "first" suppresses them)
    const borderRow = container.querySelector('.my-6');
    expect(borderRow).toBeNull();
  });
});
