import { useState, useEffect, useCallback } from 'react';

interface AuthState {
  checking: boolean;
  required: boolean;
  authenticated: boolean;
  token: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    checking: true,
    required: false,
    authenticated: false,
    token: localStorage.getItem('auth_token'),
  });

  const check = useCallback(async () => {
    try {
      const stored = localStorage.getItem('auth_token');
      const res = await fetch('/api/auth/check', {
        headers: stored ? { 'x-auth-token': stored } : {},
      });
      const data = await res.json();
      if (!data.required) {
        setState({ checking: false, required: false, authenticated: true, token: null });
      } else if (data.authenticated) {
        setState({ checking: false, required: true, authenticated: true, token: stored });
      } else {
        localStorage.removeItem('auth_token');
        setState({ checking: false, required: true, authenticated: false, token: null });
      }
    } catch {
      setState(prev => ({ ...prev, checking: false }));
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  const login = useCallback(async (password: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok && data.token) {
        localStorage.setItem('auth_token', data.token);
        setState({ checking: false, required: true, authenticated: true, token: data.token });
        return true;
      } else if (data.ok) {
        setState({ checking: false, required: false, authenticated: true, token: null });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('auth_token');
    setState({ checking: false, required: true, authenticated: false, token: null });
  }, []);

  return { ...state, login, logout };
}

// Helper to get auth headers for fetch calls
export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  return token ? { 'x-auth-token': token } : {};
}
