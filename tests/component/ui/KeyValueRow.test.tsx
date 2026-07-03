import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyValueRow, DefinitionList } from '../../../src/components/ui/KeyValueRow';

describe('KeyValueRow', () => {
  it('renders label and value', () => {
    render(<KeyValueRow label="Domain Authority" value="42" />);
    expect(screen.getByText('Domain Authority')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('applies the mono font family to the value when mono is set', () => {
    render(<KeyValueRow label="Hash" value="a1b2c3" mono />);
    const value = screen.getByText('a1b2c3');
    expect(value.style.fontFamily).toBe('var(--font-mono)');
  });
});

describe('DefinitionList', () => {
  it('renders a <dl> with the correct dt/dd count', () => {
    const items = [
      { label: 'Impressions', value: '1,200' },
      { label: 'Clicks', value: '84' },
      { label: 'CTR', value: '7%' },
    ];
    const { container } = render(<DefinitionList items={items} />);
    const dl = container.querySelector('dl');
    expect(dl).toBeInTheDocument();
    expect(container.querySelectorAll('dt').length).toBe(3);
    expect(container.querySelectorAll('dd').length).toBe(3);
  });
});
