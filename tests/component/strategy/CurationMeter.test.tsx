// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CurationMeter } from '../../../src/components/strategy/CurationMeter';

describe('CurationMeter', () => {
  it('shows the curated count and a healthy phrase for a small set', () => {
    render(<CurationMeter sentThisCycle={4} />);
    expect(screen.getByText(/4 sent/i)).toBeInTheDocument();
    expect(screen.getByText(/healthy curated set/i)).toBeInTheDocument();
  });

  it('warns when over-sending', () => {
    render(<CurationMeter sentThisCycle={12} />);
    expect(screen.getByText(/12 sent/i)).toBeInTheDocument();
    expect(screen.getByText(/curate, don.t just send/i)).toBeInTheDocument();
  });

  it('renders nothing when nothing has been sent this cycle', () => {
    const { container } = render(<CurationMeter sentThisCycle={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses the compact Engine support-row presentation without changing its copy', () => {
    render(<CurationMeter sentThisCycle={4} presentation="engine-spine" />);

    const meter = screen.getByTestId('curation-meter');
    expect(meter).toHaveAttribute('data-presentation', 'engine-spine');
    expect(meter).toHaveClass('px-2.5', 'py-1');
    expect(meter).toHaveTextContent('4 sent');
    expect(meter).toHaveTextContent('a healthy curated set');
  });
});
