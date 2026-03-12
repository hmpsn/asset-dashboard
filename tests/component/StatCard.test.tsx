import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatCard, CompactStatBar } from '../../src/components/ui/StatCard';
import { TrendingUp } from 'lucide-react';

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Sessions" value={1234} />);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('1234')).toBeInTheDocument();
  });

  it('renders as a div when no onClick', () => {
    const { container } = render(<StatCard label="Metric" value={42} />);
    expect(container.querySelector('div')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders as a button when onClick is provided', () => {
    const fn = vi.fn();
    render(<StatCard label="Clickable" value={10} onClick={fn} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('displays sub text when provided', () => {
    render(<StatCard label="Views" value={500} sub="per day" />);
    expect(screen.getByText('per day')).toBeInTheDocument();
  });

  it('displays positive delta with + prefix', () => {
    render(<StatCard label="Traffic" value={100} delta={15} />);
    expect(screen.getByText('+15')).toBeInTheDocument();
  });

  it('displays negative delta without + prefix', () => {
    render(<StatCard label="Traffic" value={100} delta={-5} />);
    expect(screen.getByText('-5')).toBeInTheDocument();
  });

  it('does not display delta when zero', () => {
    const { container } = render(<StatCard label="Traffic" value={100} delta={0} />);
    // No delta span should be rendered
    const deltaSpans = container.querySelectorAll('.text-green-400, .text-red-400');
    expect(deltaSpans.length).toBe(0);
  });

  it('displays deltaLabel alongside delta', () => {
    render(<StatCard label="Traffic" value={100} delta={10} deltaLabel="%" />);
    expect(screen.getByText('+10%')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    const { container } = render(<StatCard label="Up" value={1} icon={TrendingUp} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(<StatCard label="X" value={0} className="w-full" />);
    expect(container.firstElementChild!.className).toContain('w-full');
  });
});

describe('CompactStatBar', () => {
  it('renders all items', () => {
    const items = [
      { label: 'Pages', value: 25 },
      { label: 'Errors', value: 3 },
      { label: 'Score', value: '87%' },
    ];
    render(<CompactStatBar items={items} />);
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
  });

  it('renders sub text for items that have it', () => {
    const items = [{ label: 'Traffic', value: 500, sub: '+12%' }];
    render(<CompactStatBar items={items} />);
    expect(screen.getByText('+12%')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<CompactStatBar items={[]} className="mb-4" />);
    expect(container.firstElementChild!.className).toContain('mb-4');
  });
});
