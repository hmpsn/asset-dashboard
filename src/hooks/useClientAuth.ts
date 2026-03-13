import { useState, useCallback } from 'react';
import { post } from '../api/client';
import type { WorkspaceInfo } from '../components/client/types';

export interface ClientUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface ClientAuthState {
  authenticated: boolean;
  authLoading: boolean;
  authError: string;
  authMode: { hasSharedPassword: boolean; hasClientUsers: boolean } | null;
  clientUser: ClientUser | null;
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
}

export interface ClientAuthActions {
  setAuthenticated: React.Dispatch<React.SetStateAction<boolean>>;
  setAuthLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setAuthError: React.Dispatch<React.SetStateAction<string>>;
  setAuthMode: React.Dispatch<React.SetStateAction<{ hasSharedPassword: boolean; hasClientUsers: boolean } | null>>;
  setClientUser: React.Dispatch<React.SetStateAction<ClientUser | null>>;
  setLoginTab: React.Dispatch<React.SetStateAction<'password' | 'user'>>;
  setLoginEmail: React.Dispatch<React.SetStateAction<string>>;
  setLoginPassword: React.Dispatch<React.SetStateAction<string>>;
  setLoginView: React.Dispatch<React.SetStateAction<'login' | 'forgot' | 'reset'>>;
  setForgotEmail: React.Dispatch<React.SetStateAction<string>>;
  setForgotSent: React.Dispatch<React.SetStateAction<boolean>>;
  setResetToken: React.Dispatch<React.SetStateAction<string>>;
  setResetPassword: React.Dispatch<React.SetStateAction<string>>;
  setResetConfirm: React.Dispatch<React.SetStateAction<string>>;
  setResetDone: React.Dispatch<React.SetStateAction<boolean>>;
  setPasswordInput: React.Dispatch<React.SetStateAction<string>>;
  handlePasswordSubmit: (e?: React.FormEvent) => Promise<void>;
  handleClientUserLogin: (e?: React.FormEvent) => Promise<void>;
  handleClientLogout: () => Promise<void>;
}

export function useClientAuth(
  workspaceId: string,
  ws: WorkspaceInfo | null,
  loadDashboardData: (data: WorkspaceInfo) => void,
  getTurnstileToken?: () => string | undefined,
  onTurnstileReset?: () => void,
): ClientAuthState & ClientAuthActions {
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authMode, setAuthMode] = useState<{ hasSharedPassword: boolean; hasClientUsers: boolean } | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [clientUser, setClientUser] = useState<ClientUser | null>(null);
  const [loginTab, setLoginTab] = useState<'password' | 'user'>('user');
  const [loginView, setLoginView] = useState<'login' | 'forgot' | 'reset'>('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetDone, setResetDone] = useState(false);

  const handlePasswordSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!passwordInput.trim()) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      await post(`/api/public/auth/${workspaceId}`, { password: passwordInput });
      setAuthenticated(true);
      sessionStorage.setItem(`dash_auth_${workspaceId}`, 'true');
      if (ws) loadDashboardData(ws);
    } catch {
      setAuthError('Incorrect password');
    } finally { setAuthLoading(false); }
  }, [workspaceId, ws, passwordInput, loadDashboardData]);

  const handleClientUserLogin = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!loginEmail.trim() || !loginPassword.trim()) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const turnstileToken = getTurnstileToken?.();
      const data = await post<{ user: ClientUser }>(`/api/public/client-login/${workspaceId}`, { email: loginEmail.trim(), password: loginPassword.trim(), turnstileToken });
      setClientUser(data.user);
      setAuthenticated(true);
      sessionStorage.setItem(`dash_auth_${workspaceId}`, 'true');
      if (ws) loadDashboardData(ws);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid email or password';
      setAuthError(msg);
      onTurnstileReset?.();
    } finally { setAuthLoading(false); }
  }, [workspaceId, ws, loginEmail, loginPassword, loadDashboardData, getTurnstileToken, onTurnstileReset]);

  const handleClientLogout = useCallback(async () => {
    try {
      await post(`/api/public/client-logout/${workspaceId}`);
    } catch { /* ignore */ }
    setClientUser(null);
    setAuthenticated(false);
    sessionStorage.removeItem(`dash_auth_${workspaceId}`);
  }, [workspaceId]);

  return {
    authenticated, setAuthenticated,
    authLoading, setAuthLoading,
    authError, setAuthError,
    authMode, setAuthMode,
    clientUser, setClientUser,
    loginTab, setLoginTab,
    loginEmail, setLoginEmail,
    loginPassword, setLoginPassword,
    loginView, setLoginView,
    forgotEmail, setForgotEmail,
    forgotSent, setForgotSent,
    resetToken, setResetToken,
    resetPassword, setResetPassword,
    resetConfirm, setResetConfirm,
    resetDone, setResetDone,
    passwordInput, setPasswordInput,
    handlePasswordSubmit,
    handleClientUserLogin,
    handleClientLogout,
  };
}
