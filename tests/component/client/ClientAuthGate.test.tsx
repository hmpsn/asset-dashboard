/**
 * Component tests for ClientAuthGate.
 *
 * The existing auth test (ClientDashboard-auth.test.tsx) focuses on the
 * useClientAuth hook and lib helpers. These tests focus exclusively on the
 * ClientAuthGate component's rendering: which form is shown given which props,
 * error/loading states, and inter-state transitions via button clicks.
 *
 * TurnstileWidget renders nothing in jsdom (VITE_TURNSTILE_SITE_KEY is unset)
 * so no mock is needed for it.
 */
import { describe, it, expect, vi, beforeEach, type MutableRefObject } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ClientAuthGate } from '../../../src/components/client/ClientAuthGate';
import type { WorkspaceInfo } from '../../../src/components/client/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseWs: WorkspaceInfo = {
  id: 'ws-auth',
  name: 'Auth Workspace',
};

const tokenRef: MutableRefObject<string | undefined> = { current: undefined };

const baseProps = {
  workspaceId: 'ws-auth',
  ws: baseWs,
  authLoading: false,
  authError: '',
  authMode: { hasSharedPassword: true, hasClientUsers: false },
  loginTab: 'password' as const,
  loginEmail: '',
  loginPassword: '',
  loginView: 'login' as const,
  forgotEmail: '',
  forgotSent: false,
  resetToken: '',
  resetPassword: '',
  resetConfirm: '',
  resetDone: false,
  passwordInput: '',
  turnstileReset: 0,
  tokenRef,
  setLoginTab: vi.fn(),
  setLoginEmail: vi.fn(),
  setLoginPassword: vi.fn(),
  setLoginView: vi.fn(),
  setForgotEmail: vi.fn(),
  setForgotSent: vi.fn(),
  setResetPassword: vi.fn(),
  setResetConfirm: vi.fn(),
  setResetDone: vi.fn(),
  setPasswordInput: vi.fn(),
  setAuthError: vi.fn(),
  setAuthLoading: vi.fn(),
  setTurnstileReset: vi.fn(),
  handlePasswordSubmit: vi.fn(),
  handleClientUserLogin: vi.fn(),
};

const renderGate = (props = {}) =>
  render(
    <MemoryRouter>
      <ClientAuthGate {...baseProps} {...props} />
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────

describe('ClientAuthGate — shared password form', () => {
  it('renders without crashing', () => {
    renderGate();
    expect(screen.getByPlaceholderText(/Dashboard password/i)).toBeInTheDocument();
  });

  it('renders the workspace name', () => {
    renderGate();
    expect(screen.getByText('Auth Workspace')).toBeInTheDocument();
  });

  it('renders the logo image', () => {
    renderGate();
    const logo = screen.getByRole('img');
    expect(logo).toBeInTheDocument();
    expect(logo.getAttribute('src')).toBe('/logo.svg');
  });

  it('renders the "Access Dashboard" submit button', () => {
    renderGate();
    expect(screen.getByRole('button', { name: /Access Dashboard/i })).toBeInTheDocument();
  });

  it('submit button is disabled when password input is empty', () => {
    renderGate({ passwordInput: '' });
    expect(screen.getByRole('button', { name: /Access Dashboard/i })).toBeDisabled();
  });

  it('submit button is enabled when password input has text', () => {
    renderGate({ passwordInput: 'hunter2' });
    expect(screen.getByRole('button', { name: /Access Dashboard/i })).not.toBeDisabled();
  });

  it('shows error message when authError is set', () => {
    renderGate({ authError: 'Incorrect password' });
    expect(screen.getByText('Incorrect password')).toBeInTheDocument();
  });

  it('calls handlePasswordSubmit on form submit', () => {
    const handlePasswordSubmit = vi.fn();
    renderGate({ passwordInput: 'secret', handlePasswordSubmit });
    const form = screen.getByPlaceholderText(/Dashboard password/i).closest('form');
    fireEvent.submit(form!);
    expect(handlePasswordSubmit).toHaveBeenCalled();
  });

  it('submit button is disabled while authLoading is true', () => {
    renderGate({ authLoading: true, passwordInput: 'hunter2' });
    // When loading, the button text is cleared — query by type="submit" instead
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn).toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ClientAuthGate — user login form', () => {
  const userLoginProps = {
    authMode: { hasSharedPassword: false, hasClientUsers: true },
    loginTab: 'user' as const,
  };

  it('renders email and password inputs for user login', () => {
    renderGate(userLoginProps);
    expect(screen.getByPlaceholderText(/Email address/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/^Password$/i)).toBeInTheDocument();
  });

  it('renders "Sign In" submit button', () => {
    renderGate(userLoginProps);
    expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeInTheDocument();
  });

  it('sign-in button is disabled when email or password is empty', () => {
    renderGate({ ...userLoginProps, loginEmail: '', loginPassword: '' });
    expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeDisabled();
  });

  it('sign-in button is enabled when both email and password are provided', () => {
    renderGate({ ...userLoginProps, loginEmail: 'a@b.com', loginPassword: 'pass123' });
    expect(screen.getByRole('button', { name: /^Sign In$/i })).not.toBeDisabled();
  });

  it('shows error message on failed login', () => {
    renderGate({ ...userLoginProps, authError: 'Invalid email or password' });
    expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
  });

  it('shows "Forgot your password?" link', () => {
    renderGate(userLoginProps);
    expect(screen.getByRole('button', { name: /Forgot your password/i })).toBeInTheDocument();
  });

  it('calls setLoginView("forgot") when forgot password is clicked', () => {
    const setLoginView = vi.fn();
    renderGate({ ...userLoginProps, setLoginView });
    fireEvent.click(screen.getByRole('button', { name: /Forgot your password/i }));
    expect(setLoginView).toHaveBeenCalledWith('forgot');
  });

  it('shows "Sign in with your account" description when loginTab is user', () => {
    renderGate(userLoginProps);
    expect(screen.getByText(/Sign in with your account/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ClientAuthGate — both modes available', () => {
  const bothModesProps = {
    authMode: { hasSharedPassword: true, hasClientUsers: true },
    loginTab: 'password' as const,
  };

  it('shows "Sign in with your email instead" link when both modes are available and on password tab', () => {
    renderGate(bothModesProps);
    expect(screen.getByRole('button', { name: /Sign in with your email instead/i })).toBeInTheDocument();
  });

  it('calls setLoginTab("user") when the switch link is clicked', () => {
    const setLoginTab = vi.fn();
    renderGate({ ...bothModesProps, setLoginTab });
    fireEvent.click(screen.getByRole('button', { name: /Sign in with your email instead/i }));
    expect(setLoginTab).toHaveBeenCalledWith('user');
  });

  it('shows "Have a shared password instead?" when on user tab in both-mode', () => {
    renderGate({
      authMode: { hasSharedPassword: true, hasClientUsers: true },
      loginTab: 'user' as const,
    });
    expect(screen.getByRole('button', { name: /Have a shared password instead/i })).toBeInTheDocument();
  });

  it('calls setLoginTab("password") when the switch-to-password link is clicked', () => {
    const setLoginTab = vi.fn();
    renderGate({
      authMode: { hasSharedPassword: true, hasClientUsers: true },
      loginTab: 'user' as const,
      setLoginTab,
    });
    fireEvent.click(screen.getByRole('button', { name: /Have a shared password instead/i }));
    expect(setLoginTab).toHaveBeenCalledWith('password');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ClientAuthGate — forgot password view', () => {
  const forgotProps = {
    authMode: { hasSharedPassword: false, hasClientUsers: true },
    loginTab: 'user' as const,
    loginView: 'forgot' as const,
  };

  it('renders the forgot password form', () => {
    renderGate(forgotProps);
    expect(screen.getByPlaceholderText(/Email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Reset Link/i })).toBeInTheDocument();
  });

  it('shows confirmation message after forgotSent is true', () => {
    renderGate({ ...forgotProps, forgotSent: true });
    expect(screen.getByText(/Check your email/i)).toBeInTheDocument();
  });

  it('shows "Back to Sign In" button after email is sent', () => {
    renderGate({ ...forgotProps, forgotSent: true });
    expect(screen.getByRole('button', { name: /Back to Sign In/i })).toBeInTheDocument();
  });

  it('calls setLoginView("login") when "Back to Sign In" is clicked after send', () => {
    const setLoginView = vi.fn();
    renderGate({ ...forgotProps, forgotSent: true, setLoginView });
    fireEvent.click(screen.getByRole('button', { name: /Back to Sign In/i }));
    expect(setLoginView).toHaveBeenCalledWith('login');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ClientAuthGate — reset password view', () => {
  const resetProps = {
    authMode: { hasSharedPassword: false, hasClientUsers: true },
    loginTab: 'user' as const,
    loginView: 'reset' as const,
    resetToken: 'tok123',
  };

  it('renders new password and confirm password fields', () => {
    renderGate(resetProps);
    // Use exact placeholder text to avoid matching "Confirm new password" with /New password/i
    expect(screen.getByPlaceholderText('New password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Confirm new password')).toBeInTheDocument();
  });

  it('renders "Set New Password" button', () => {
    renderGate(resetProps);
    expect(screen.getByRole('button', { name: /Set New Password/i })).toBeInTheDocument();
  });

  it('shows success message after resetDone is true', () => {
    renderGate({ ...resetProps, resetDone: true });
    expect(screen.getByText(/Password updated!/i)).toBeInTheDocument();
  });

  it('shows "Sign In" button after password reset is done', () => {
    renderGate({ ...resetProps, resetDone: true });
    expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeInTheDocument();
  });
});
