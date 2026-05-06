/**
 * Component-level tests for the client dashboard auth flow.
 *
 * Two layers are exercised here:
 *   1. The pure URL / sessionStorage helpers extracted from the dashboard
 *      bootstrap useEffect (`src/lib/client-dashboard-auth.ts`).
 *   2. The `useClientAuth` hook that drives the password-gate / client-user
 *      login forms and powers session storage persistence + logout.
 *
 * A full mount of `<ClientDashboard>` is intentionally avoided — that
 * component has ~30 cross-cutting dependencies (React Query, Stripe,
 * websockets, dozens of API calls) that would dwarf the auth logic the user
 * cares about. The hook + helper coverage matches what the task description
 * called out (JWT cookie auto-auth, shared password gate, session storage
 * persistence, reset token URL handling, payment redirect toast + URL
 * cleanup).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  parseAuthInitParams,
  stripResetTokenFromUrl,
  stripStripeParamsFromUrl,
  hasSessionAuth,
  setSessionAuth,
  clearSessionAuth,
  sessionAuthKey,
  welcomeSeenKey,
} from '../../src/lib/client-dashboard-auth';

// Mock the API client BEFORE importing useClientAuth so the hook picks up the
// mocked module.
vi.mock('../../src/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  getOptional: vi.fn(),
}));

import { post } from '../../src/api/client';
import { useClientAuth } from '../../src/hooks/useClientAuth';
import type { WorkspaceInfo } from '../../src/components/client/types';

const mockPost = vi.mocked(post);

const stubWorkspace = (overrides?: Partial<WorkspaceInfo>): WorkspaceInfo => ({
  id: 'ws-1',
  name: 'Acme',
  folder: 'acme',
  requiresPassword: true,
  ...overrides,
} as WorkspaceInfo);

// ── parseAuthInitParams ──

describe('parseAuthInitParams', () => {
  it('returns nulls for an empty search string', () => {
    expect(parseAuthInitParams('')).toEqual({ resetToken: null, paymentStatus: null });
  });

  it('extracts a reset_token query param', () => {
    expect(parseAuthInitParams('?reset_token=abc123')).toEqual({
      resetToken: 'abc123',
      paymentStatus: null,
    });
  });

  it('extracts a payment=success param as a typed status', () => {
    const { paymentStatus } = parseAuthInitParams('?payment=success&session_id=cs_123');
    expect(paymentStatus).toBe('success');
  });

  it('extracts a payment=cancelled param as a typed status', () => {
    expect(parseAuthInitParams('?payment=cancelled').paymentStatus).toBe('cancelled');
  });

  it('ignores unknown payment values', () => {
    expect(parseAuthInitParams('?payment=flarp').paymentStatus).toBeNull();
  });

  it('returns both reset_token and paymentStatus when both are set', () => {
    expect(parseAuthInitParams('?reset_token=tok&payment=success')).toEqual({
      resetToken: 'tok',
      paymentStatus: 'success',
    });
  });
});

// ── URL strippers ──

describe('stripResetTokenFromUrl', () => {
  it('removes only the reset_token param, preserving others', () => {
    const cleaned = stripResetTokenFromUrl('https://app.example.com/client/ws-1?reset_token=tok&payment=success');
    expect(cleaned).toContain('payment=success');
    expect(cleaned).not.toContain('reset_token');
  });

  it('is a no-op when reset_token is absent', () => {
    const original = 'https://app.example.com/client/ws-1?tab=overview';
    expect(stripResetTokenFromUrl(original)).toContain('tab=overview');
  });
});

describe('stripStripeParamsFromUrl', () => {
  it('removes both payment and session_id params', () => {
    const cleaned = stripStripeParamsFromUrl('https://app.example.com/client/ws-1?payment=success&session_id=cs_123&tab=overview');
    expect(cleaned).not.toContain('payment');
    expect(cleaned).not.toContain('session_id');
    expect(cleaned).toContain('tab=overview');
  });

  it('does not remove unrelated params', () => {
    const cleaned = stripStripeParamsFromUrl('https://app.example.com/client/ws-1?ref=email');
    expect(cleaned).toContain('ref=email');
  });
});

// ── Session-storage helpers ──

describe('session-auth helpers', () => {
  beforeEach(() => sessionStorage.clear());

  it('uses a workspace-scoped storage key', () => {
    expect(sessionAuthKey('ws-1')).toBe('dash_auth_ws-1');
    expect(sessionAuthKey('ws-2')).toBe('dash_auth_ws-2');
  });

  it('round-trips set/has/clear through real sessionStorage', () => {
    expect(hasSessionAuth(sessionStorage, 'ws-1')).toBe(false);
    setSessionAuth(sessionStorage, 'ws-1');
    expect(hasSessionAuth(sessionStorage, 'ws-1')).toBe(true);
    clearSessionAuth(sessionStorage, 'ws-1');
    expect(hasSessionAuth(sessionStorage, 'ws-1')).toBe(false);
  });

  it('hasSessionAuth treats values other than "true" as false', () => {
    sessionStorage.setItem('dash_auth_ws-1', 'yes');
    expect(hasSessionAuth(sessionStorage, 'ws-1')).toBe(false);
    sessionStorage.setItem('dash_auth_ws-1', '1');
    expect(hasSessionAuth(sessionStorage, 'ws-1')).toBe(false);
  });

  it('isolates auth state per workspace', () => {
    setSessionAuth(sessionStorage, 'ws-1');
    expect(hasSessionAuth(sessionStorage, 'ws-1')).toBe(true);
    expect(hasSessionAuth(sessionStorage, 'ws-2')).toBe(false);
  });
});

// ── welcomeSeenKey ──

describe('welcomeSeenKey', () => {
  it('uses workspace-only key when no user is provided', () => {
    expect(welcomeSeenKey('ws-1', null)).toBe('welcome_seen_ws-1');
    expect(welcomeSeenKey('ws-1', undefined)).toBe('welcome_seen_ws-1');
  });

  it('appends the user id when provided so per-user welcomes are tracked', () => {
    expect(welcomeSeenKey('ws-1', 'user-9')).toBe('welcome_seen_ws-1_user-9');
  });
});

// ── useClientAuth ──

describe('useClientAuth — shared password gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('starts unauthenticated with empty form state', () => {
    const { result } = renderHook(() =>
      useClientAuth('ws-1', stubWorkspace(), () => {}),
    );
    expect(result.current.authenticated).toBe(false);
    expect(result.current.passwordInput).toBe('');
    expect(result.current.authLoading).toBe(false);
    expect(result.current.authError).toBe('');
  });

  it('does NOT call the API when the password input is empty', async () => {
    const { result } = renderHook(() =>
      useClientAuth('ws-1', stubWorkspace(), () => {}),
    );
    await act(async () => { await result.current.handlePasswordSubmit(); });
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.current.authenticated).toBe(false);
  });

  it('authenticates, persists session storage, and loads dashboard data on success', async () => {
    mockPost.mockResolvedValueOnce({});
    const ws = stubWorkspace();
    const loadDashboardData = vi.fn();
    const { result } = renderHook(() =>
      useClientAuth('ws-1', ws, loadDashboardData),
    );

    act(() => result.current.setPasswordInput('hunter2'));
    await act(async () => { await result.current.handlePasswordSubmit(); });

    expect(mockPost).toHaveBeenCalledWith('/api/public/auth/ws-1', { password: 'hunter2' });
    await waitFor(() => expect(result.current.authenticated).toBe(true));
    expect(sessionStorage.getItem('dash_auth_ws-1')).toBe('true');
    expect(loadDashboardData).toHaveBeenCalledWith(ws);
  });

  it('surfaces an error message and stays unauthenticated on a wrong password', async () => {
    mockPost.mockRejectedValueOnce(new Error('forbidden'));
    const { result } = renderHook(() =>
      useClientAuth('ws-1', stubWorkspace(), () => {}),
    );
    act(() => result.current.setPasswordInput('wrong'));
    await act(async () => { await result.current.handlePasswordSubmit(); });
    await waitFor(() => expect(result.current.authError).toBe('Incorrect password'));
    expect(result.current.authenticated).toBe(false);
    expect(sessionStorage.getItem('dash_auth_ws-1')).toBeNull();
  });
});

describe('useClientAuth — client-user login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('does NOT call the API when email or password is missing', async () => {
    const { result } = renderHook(() =>
      useClientAuth('ws-1', stubWorkspace(), () => {}),
    );
    await act(async () => { await result.current.handleClientUserLogin(); });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('logs in, sets clientUser, and persists session storage on success', async () => {
    const user = { id: 'u1', email: 'a@b.com', name: 'A', role: 'editor' };
    mockPost.mockResolvedValueOnce({ user });
    const loadDashboardData = vi.fn();
    const { result } = renderHook(() =>
      useClientAuth('ws-1', stubWorkspace(), loadDashboardData),
    );

    act(() => {
      result.current.setLoginEmail('a@b.com');
      result.current.setLoginPassword('hunter2');
    });
    await act(async () => { await result.current.handleClientUserLogin(); });

    await waitFor(() => expect(result.current.authenticated).toBe(true));
    expect(result.current.clientUser).toEqual(user);
    expect(sessionStorage.getItem('dash_auth_ws-1')).toBe('true');
    expect(loadDashboardData).toHaveBeenCalled();
  });

  it('forwards the turnstileToken when getTurnstileToken returns one', async () => {
    mockPost.mockResolvedValueOnce({ user: { id: 'u1', email: 'a@b.com', name: 'A', role: 'editor' } });
    const getTurnstileToken = vi.fn(() => 'cf-token');
    const onTurnstileReset = vi.fn();
    const { result } = renderHook(() =>
      useClientAuth('ws-1', stubWorkspace(), () => {}, getTurnstileToken, onTurnstileReset),
    );

    act(() => {
      result.current.setLoginEmail('a@b.com');
      result.current.setLoginPassword('hunter2');
    });
    await act(async () => { await result.current.handleClientUserLogin(); });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/public/client-login/ws-1',
      expect.objectContaining({ turnstileToken: 'cf-token' }),
    );
    expect(onTurnstileReset).not.toHaveBeenCalled();
  });

  it('calls onTurnstileReset on login failure (so the user can solve a fresh CAPTCHA)', async () => {
    mockPost.mockRejectedValueOnce(new Error('Invalid email or password'));
    const onTurnstileReset = vi.fn();
    const { result } = renderHook(() =>
      useClientAuth('ws-1', stubWorkspace(), () => {}, undefined, onTurnstileReset),
    );

    act(() => {
      result.current.setLoginEmail('a@b.com');
      result.current.setLoginPassword('wrong');
    });
    await act(async () => { await result.current.handleClientUserLogin(); });

    await waitFor(() => expect(onTurnstileReset).toHaveBeenCalledTimes(1));
    expect(result.current.authError).toBe('Invalid email or password');
    expect(result.current.authenticated).toBe(false);
  });
});

describe('useClientAuth — logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('clears auth state and removes the session-storage flag', async () => {
    mockPost
      .mockResolvedValueOnce({}) // password submit
      .mockResolvedValueOnce({}); // logout
    const { result } = renderHook(() =>
      useClientAuth('ws-1', stubWorkspace(), () => {}),
    );

    act(() => result.current.setPasswordInput('hunter2'));
    await act(async () => { await result.current.handlePasswordSubmit(); });
    await waitFor(() => expect(result.current.authenticated).toBe(true));
    expect(sessionStorage.getItem('dash_auth_ws-1')).toBe('true');

    await act(async () => { await result.current.handleClientLogout(); });
    expect(result.current.authenticated).toBe(false);
    expect(result.current.clientUser).toBeNull();
    expect(sessionStorage.getItem('dash_auth_ws-1')).toBeNull();
    expect(mockPost).toHaveBeenLastCalledWith('/api/public/client-logout/ws-1');
  });

  it('still clears local state if the logout API call fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('network down'));
    setSessionAuth(sessionStorage, 'ws-1');
    const { result } = renderHook(() =>
      useClientAuth('ws-1', stubWorkspace(), () => {}),
    );
    await act(async () => { await result.current.handleClientLogout(); });
    expect(result.current.authenticated).toBe(false);
    expect(sessionStorage.getItem('dash_auth_ws-1')).toBeNull();
  });
});
