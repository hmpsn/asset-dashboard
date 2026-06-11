import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreshnessStamp } from '../../src/components/ui';

describe('FreshnessStamp', () => {
  it('renders a timestamp when a valid millisecond value is provided', () => {
    render(<FreshnessStamp value={new Date('2026-06-11T15:30:00.000Z').getTime()} />);

    expect(screen.getByText(/Data as of/i)).toBeInTheDocument();
    expect(screen.getByText((_content, element) => {
      return element?.tagName.toLowerCase() === 'time'
        && element.getAttribute('dateTime') === '2026-06-11T15:30:00.000Z';
    })).toBeInTheDocument();
  });

  it('renders an ISO timestamp with a custom label', () => {
    render(<FreshnessStamp value="2026-06-11T16:45:00.000Z" label="Search data as of" />);

    expect(screen.getByText(/Search data as of/i)).toBeInTheDocument();
    expect(screen.getByText((_content, element) => {
      return element?.tagName.toLowerCase() === 'time'
        && element.getAttribute('dateTime') === '2026-06-11T16:45:00.000Z';
    })).toBeInTheDocument();
  });

  it('renders nothing when freshness is missing or invalid', () => {
    const { rerender, container } = render(<FreshnessStamp value={null} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<FreshnessStamp value={0} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<FreshnessStamp value="not-a-date" />);
    expect(container).toBeEmptyDOMElement();
  });
});
