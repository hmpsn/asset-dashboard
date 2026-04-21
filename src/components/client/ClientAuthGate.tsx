import { useCallback } from 'react';
import type React from 'react';
import { Loader2, Lock } from 'lucide-react';
import { post } from '../../api/client';
import TurnstileWidget from '../TurnstileWidget';
import { STUDIO_NAME } from '../../constants';
import type { WorkspaceInfo } from './types';

export interface ClientAuthGateProps {
  workspaceId: string;
  ws: WorkspaceInfo | null;
  authLoading: boolean;
  authError: string;
  authMode: { hasSharedPassword: boolean; hasClientUsers: boolean } | null;
  loginTab: 'password' | 'user';
  loginEmail: string;
  loginPassword: string;
  loginView: 'login' | 'forgot' | 'reset';
  forgotEmail: string;
  forgotSent: boolean;
  resetToken: string;
  resetPassword: string;
  resetConfirm: string;
  resetDone: boolean;
  passwordInput: string;
  turnstileReset: number;
  tokenRef: React.MutableRefObject<string | undefined>;
  // Setters
  setLoginTab: (tab: 'password' | 'user') => void;
  setLoginEmail: (email: string) => void;
  setLoginPassword: (password: string) => void;
  setLoginView: (view: 'login' | 'forgot' | 'reset') => void;
  setForgotEmail: (email: string) => void;
  setForgotSent: (sent: boolean) => void;
  setResetPassword: (password: string) => void;
  setResetConfirm: (password: string) => void;
  setResetDone: (done: boolean) => void;
  setPasswordInput: (input: string) => void;
  setAuthError: (error: string) => void;
  setAuthLoading: (loading: boolean) => void;
  setTurnstileReset: (reset: number | ((r: number) => number)) => void;
  // Handlers from parent (will be wrapped with Turnstile logic)
  handlePasswordSubmit: (e?: React.FormEvent) => Promise<void>;
  handleClientUserLogin: (e?: React.FormEvent) => Promise<void>;
}

export function ClientAuthGate({
  workspaceId,
  ws,
  authLoading,
  authError,
  authMode,
  loginTab,
  loginEmail,
  loginPassword,
  loginView,
  forgotEmail,
  forgotSent,
  resetToken,
  resetPassword,
  resetConfirm,
  resetDone,
  passwordInput,
  turnstileReset,
  tokenRef,
  setLoginTab,
  setLoginEmail,
  setLoginPassword,
  setLoginView,
  setForgotEmail,
  setForgotSent,
  setResetPassword,
  setResetConfirm,
  setResetDone,
  setPasswordInput,
  setAuthError,
  setAuthLoading,
  setTurnstileReset,
  handlePasswordSubmit,
  handleClientUserLogin,
}: ClientAuthGateProps) {
  // Mode detection
  const showsUserLogin = authMode?.hasClientUsers;
  const showsPasswordLogin = authMode?.hasSharedPassword && !authMode?.hasClientUsers;
  const showsBothModes = authMode?.hasSharedPassword && authMode?.hasClientUsers;

  // Handler for forgot password that includes Turnstile token
  const handleForgotPasswordSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!forgotEmail.trim()) return;
      setAuthLoading(true);
      setAuthError('');
      try {
        await post(`/api/public/forgot-password/${workspaceId}`, {
          email: forgotEmail.trim(),
          turnstileToken: tokenRef.current,
        });
        setForgotSent(true);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Something went wrong');
        setTurnstileReset((r) => r + 1);
      }
      setAuthLoading(false);
    },
    [forgotEmail, workspaceId, setAuthLoading, setAuthError, setForgotSent, setTurnstileReset]
  );

  // Handler for reset password
  const handleResetPasswordSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (resetPassword !== resetConfirm) {
        setAuthError('Passwords do not match');
        return;
      }
      if (resetPassword.length < 8) {
        setAuthError('Password must be at least 8 characters');
        return;
      }
      setAuthLoading(true);
      setAuthError('');
      try {
        await post('/api/public/reset-password', { token: resetToken, newPassword: resetPassword });
        setResetDone(true);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Something went wrong');
      }
      setAuthLoading(false);
    },
    [resetPassword, resetConfirm, resetToken, setAuthError, setAuthLoading, setResetDone]
  );

  // Wrapper for handleClientUserLogin to pass Turnstile token
  const handleClientUserLoginWithTurnstile = useCallback(
    async (e: React.FormEvent) => {
      try {
        await handleClientUserLogin(e);
      } catch (err) {
        // Error already handled by parent, but we reset Turnstile on failure
        setTurnstileReset((r) => r + 1);
        throw err;
      }
    },
    [handleClientUserLogin, setTurnstileReset]
  );

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="bg-zinc-900 border border-zinc-800 p-8 shadow-2xl shadow-black/40" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <div className="flex flex-col items-center mb-6">
            <img src="/logo.svg" alt={STUDIO_NAME} className="h-7 opacity-60 mb-4" />
            <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-teal-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-200">{ws?.name}</h2>
            <p className="text-xs text-zinc-500 mt-1">
              {loginTab === 'user' ? 'Sign in with your account' : 'Enter the password to access this dashboard'}
            </p>
          </div>

          {/* Mode switch link when both modes are available */}
          {showsBothModes && loginTab === 'password' && (
            <button
              onClick={() => {
                setLoginTab('user');
                setAuthError('');
              }}
              className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 mb-4 transition-colors"
            >
              Sign in with your email instead
            </button>
          )}

          {/* Individual user login / forgot / reset form */}
          {loginTab === 'user' && (showsUserLogin || showsBothModes) ? (
            loginView === 'forgot' ? (
              // Forgot password form
              <div className="space-y-3">
                {forgotSent ? (
                  <>
                    <div className="bg-teal-500/10 border border-teal-500/20 p-4 text-center" style={{ borderRadius: '6px 12px 6px 12px' }}>
                      <p className="text-sm text-teal-400 font-medium">Check your email</p>
                      <p className="text-xs text-zinc-400 mt-1">
                        If an account exists with that email, we've sent a password reset link.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setLoginView('login');
                        setForgotSent(false);
                        setForgotEmail('');
                        setAuthError('');
                      }}
                      className="w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-all"
                    >
                      Back to Sign In
                    </button>
                  </>
                ) : (
                  <form onSubmit={handleForgotPasswordSubmit} className="space-y-3">
                    <p className="text-xs text-zinc-400 text-center">
                      Enter your email and we'll send you a link to reset your password.
                    </p>
                    <input
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => {
                        setForgotEmail(e.target.value);
                        setAuthError('');
                      }}
                      placeholder="Email address"
                      autoFocus
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                    />
                    <TurnstileWidget onToken={(t) => { tokenRef.current = t; }} resetTrigger={turnstileReset} />
                    {authError && <p className="text-xs text-red-400/80">{authError}</p>}
                    <button
                      type="submit"
                      disabled={authLoading || !forgotEmail.trim()}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
                    >
                      {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Reset Link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLoginView('login');
                        setAuthError('');
                      }}
                      className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
                    >
                      Back to Sign In
                    </button>
                  </form>
                )}
              </div>
            ) : loginView === 'reset' ? (
              // Reset password form (arrived via email link)
              <div className="space-y-3">
                {resetDone ? (
                  <>
                    <div className="bg-teal-500/10 border border-teal-500/20 p-4 text-center" style={{ borderRadius: '6px 12px 6px 12px' }}>
                      <p className="text-sm text-teal-400 font-medium">Password updated!</p>
                      <p className="text-xs text-zinc-400 mt-1">You can now sign in with your new password.</p>
                    </div>
                    <button
                      onClick={() => {
                        setLoginView('login');
                        setResetDone(false);
                        setResetPassword('');
                        setResetConfirm('');
                        setAuthError('');
                      }}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium transition-all"
                    >
                      Sign In
                    </button>
                  </>
                ) : (
                  <form onSubmit={handleResetPasswordSubmit} className="space-y-3">
                    <p className="text-xs text-zinc-400 text-center">Choose a new password for your account.</p>
                    <input
                      type="password"
                      value={resetPassword}
                      onChange={(e) => {
                        setResetPassword(e.target.value);
                        setAuthError('');
                      }}
                      placeholder="New password"
                      autoFocus
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                    />
                    <input
                      type="password"
                      value={resetConfirm}
                      onChange={(e) => {
                        setResetConfirm(e.target.value);
                        setAuthError('');
                      }}
                      placeholder="Confirm new password"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                    />
                    {authError && <p className="text-xs text-red-400/80">{authError}</p>}
                    <button
                      type="submit"
                      disabled={authLoading || !resetPassword || !resetConfirm}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
                    >
                      {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Set New Password'}
                    </button>
                  </form>
                )}
              </div>
            ) : (
              // Normal login form
              <form onSubmit={handleClientUserLoginWithTurnstile} className="space-y-3">
                <div>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => {
                      setLoginEmail(e.target.value);
                      setAuthError('');
                    }}
                    placeholder="Email address"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                    autoFocus
                  />
                </div>
                <div>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => {
                      setLoginPassword(e.target.value);
                      setAuthError('');
                    }}
                    placeholder="Password"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                  />
                </div>
                <TurnstileWidget onToken={(t) => { tokenRef.current = t; }} resetTrigger={turnstileReset} />
                {authError && <p className="text-xs text-red-400/80">{authError}</p>}
                <button
                  type="submit"
                  disabled={authLoading || !loginEmail.trim() || !loginPassword.trim()}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
                >
                  {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign In'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginView('forgot');
                    setAuthError('');
                  }}
                  className="w-full py-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
                >
                  Forgot your password?
                </button>
                {showsBothModes && (
                  <button
                    type="button"
                    onClick={() => {
                      setLoginTab('password');
                      setAuthError('');
                    }}
                    className="w-full py-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
                  >
                    Have a shared password instead?
                  </button>
                )}
              </form>
            )
          ) : (
            /* Shared password form */
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setAuthError('');
                  }}
                  placeholder="Dashboard password"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                  autoFocus={loginTab === 'password' || showsPasswordLogin}
                />
                {authError && <p className="text-xs text-red-400/80 mt-2">{authError}</p>}
              </div>
              <button
                type="submit"
                disabled={authLoading || !passwordInput.trim()}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
              >
                {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Access Dashboard'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
