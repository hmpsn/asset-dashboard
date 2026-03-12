import { useState, useCallback } from 'react';
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
      const res = await fetch(`/api/public/auth/${workspaceId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      if (res.ok) {
        setAuthenticated(true);
        sessionStorage.setItem(`dash_auth_${workspaceId}`, 'true');
        if (ws) loadDashboardData(ws);
      } else {
        setAuthError('Incorrect password');
      }
    } catch {
      setAuthError('Authentication failed');
    } finally { setAuthLoading(false); }
  }, [workspaceId, ws, passwordInput, loadDashboardData]);

  const handleClientUserLogin = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!loginEmail.trim() || !loginPassword.trim()) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch(`/api/public/client-login/${workspaceId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setClientUser(data.user);
        setAuthenticated(true);
        sessionStorage.setItem(`dash_auth_${workspaceId}`, 'true');
        if (ws) loadDashboardData(ws);
      } else {
        const err = await res.json();
        setAuthError(err.error || 'Invalid email or password');
      }
    } catch {
      setAuthError('Authentication failed');
    } finally { setAuthLoading(false); }
  }, [workspaceId, ws, loginEmail, loginPassword, loadDashboardData]);

  const handleClientLogout = useCallback(async () => {
    try {
      await fetch(`/api/public/client-logout/${workspaceId}`, { method: 'POST' });
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
