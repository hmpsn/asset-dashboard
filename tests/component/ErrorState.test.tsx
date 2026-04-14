import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorState } from '../../src/components/ui/ErrorState';

describe('ErrorState', () => {
  it('renders defaults', () => {
    render(<ErrorState />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders single action (backward compat)', () => {
    const onClick = vi.fn();
    render(<ErrorState action={{ label: 'Retry', onClick }} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders multiple actions', () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    render(
      <ErrorState
        actions={[
          { label: 'Retry', onClick: primary, variant: 'primary' },
          { label: 'Go Back', onClick: secondary, variant: 'secondary' },
        ]}
      />
    );
    fireEvent.click(screen.getByText('Retry'));
    expect(primary).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Go Back'));
    expect(secondary).toHaveBeenCalledOnce();
  });

  it('actions takes precedence over action', () => {
    const actionsClick = vi.fn();
    const actionClick = vi.fn();
    render(
      <ErrorState
        action={{ label: 'Single', onClick: actionClick }}
        actions={[{ label: 'Multi', onClick: actionsClick }]}
      />
    );
    expect(screen.queryByText('Single')).not.toBeInTheDocument();
    expect(screen.getByText('Multi')).toBeInTheDocument();
  });

  it('secondary actions have zinc styling', () => {
    render(
      <ErrorState
        actions={[{ label: 'Back', onClick: vi.fn(), variant: 'secondary' }]}
      />
    );
    const btn = screen.getByText('Back').closest('button')!;
    expect(btn.className).toContain('bg-zinc-800');
  });

  it('has role=alert on container', () => {
    render(<ErrorState />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
