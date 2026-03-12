import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginScreen } from '../../src/components/LoginScreen';

describe('LoginScreen', () => {
  it('renders password input and sign in button', () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('disables submit button when password is empty', () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('enables submit button when password is entered', async () => {
    const user = userEvent.setup();
    render(<LoginScreen onLogin={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('Enter password'), 'secret');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('calls onLogin with password on submit', async () => {
    const onLogin = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByPlaceholderText('Enter password'), 'mypassword');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('mypassword');
    });
  });

  it('shows error message when login fails', async () => {
    const onLogin = vi.fn().mockResolvedValue(false);
    const user = userEvent.setup();
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByPlaceholderText('Enter password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Incorrect password')).toBeInTheDocument();
    });
  });

  it('clears password field after failed login', async () => {
    const onLogin = vi.fn().mockResolvedValue(false);
    const user = userEvent.setup();
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByPlaceholderText('Enter password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter password')).toHaveValue('');
    });
  });

  it('shows "Signing in..." while loading', async () => {
    // Create a login that never resolves (to keep loading state)
    const onLogin = vi.fn().mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByPlaceholderText('Enter password'), 'test');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Signing in...')).toBeInTheDocument();
    });
  });

  it('renders logo and branding', () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByText('Asset Dashboard')).toBeInTheDocument();
    expect(screen.getByAltText('hmpsn.studio')).toBeInTheDocument();
  });

  it('applies error border when login fails', async () => {
    const onLogin = vi.fn().mockResolvedValue(false);
    const user = userEvent.setup();
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByPlaceholderText('Enter password'), 'bad');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Enter password');
      expect(input.className).toContain('border-red-500');
    });
  });

  it('submits on Enter key', async () => {
    const onLogin = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByPlaceholderText('Enter password'), 'test{Enter}');

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('test');
    });
  });
});
