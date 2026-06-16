import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrategyEmptyState } from '../../../src/components/strategy/StrategyEmptyState';

describe('StrategyEmptyState', () => {
  it('renders "No keyword strategy yet"', () => {
    render(<StrategyEmptyState />);
    expect(screen.getByText('No keyword strategy yet')).toBeTruthy();
  });
});
