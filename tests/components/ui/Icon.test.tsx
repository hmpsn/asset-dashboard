import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Icon } from '../../../src/components/ui/Icon';
import { TrendingUp, Send, X } from 'lucide-react';

describe('Icon', () => {
  it('renders the passed Lucide component', () => {
    const { container } = render(<Icon as={TrendingUp} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('applies correct w-N h-N class per size', () => {
    const sizes = [
      { size: 'xs' as const, expected: 'w-2 h-2' },
      { size: 'sm' as const, expected: 'w-3 h-3' },
      { size: 'md' as const, expected: 'w-4 h-4' },
      { size: 'lg' as const, expected: 'w-5 h-5' },
      { size: 'xl' as const, expected: 'w-6 h-6' },
      { size: '2xl' as const, expected: 'w-8 h-8' },
    ];

    sizes.forEach(({ size, expected }) => {
      const { container } = render(<Icon as={TrendingUp} size={size} />);
      const div = container.firstChild as HTMLElement;
      expect(div.className).toContain(expected);
    });
  });

  it('appends className to size classes', () => {
    const { container } = render(
      <Icon as={Send} size="sm" className="text-teal-400" />
    );
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain('w-3 h-3');
    expect(div.className).toContain('text-teal-400');
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Icon as={X} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('rejects invalid size at TypeScript level', () => {
    // @ts-expect-error - testing that invalid size is rejected
    <Icon as={TrendingUp} size="invalid" />;
  });
});
