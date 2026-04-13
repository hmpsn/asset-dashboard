import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextStepsCard } from '../../src/components/ui/NextStepsCard';
import { Zap } from 'lucide-react';

describe('NextStepsCard', () => {
  const defaultSteps = [
    { label: 'Step 1', onClick: vi.fn() },
    { label: 'Step 2', description: 'Details here', onClick: vi.fn(), estimatedTime: '2 min' },
  ];

  it('renders title and steps', () => {
    render(<NextStepsCard title="Audit complete" steps={defaultSteps} />);
    expect(screen.getByText('Audit complete')).toBeInTheDocument();
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('Step 2')).toBeInTheDocument();
  });

  it('renders step description and estimated time', () => {
    render(<NextStepsCard title="Done" steps={defaultSteps} />);
    expect(screen.getByText('Details here')).toBeInTheDocument();
    expect(screen.getByText('2 min')).toBeInTheDocument();
  });

  it('calls onClick when step is clicked', () => {
    const onClick = vi.fn();
    render(<NextStepsCard title="Done" steps={[{ label: 'Go', onClick }]} />);
    fireEvent.click(screen.getByText('Go'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders dismiss button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(<NextStepsCard title="Done" steps={defaultSteps} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not render dismiss button when onDismiss is not provided', () => {
    render(<NextStepsCard title="Done" steps={defaultSteps} />);
    expect(screen.queryByLabelText('Dismiss')).not.toBeInTheDocument();
  });

  it('renders custom step icon', () => {
    render(
      <NextStepsCard
        title="Done"
        steps={[{ label: 'Quick', onClick: vi.fn(), icon: Zap }]}
      />
    );
    expect(screen.getByText('Quick')).toBeInTheDocument();
  });

  it('renders nothing when steps array is empty', () => {
    const { container } = render(<NextStepsCard title="Done" steps={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
