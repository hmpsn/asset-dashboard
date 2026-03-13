// ── Auth API ───────────────────────────────────────────────────────
import { get, post, getSafe } from './client';

export const auth = {
  login: (body: { password: string }) =>
    post<{ token: string }>('/api/auth/login', body),

  me: () => get<unknown>('/api/auth/me'),

  refresh: () => post<{ token: string }>('/api/auth/refresh'),
};

export const clientAuth = {
  login: (wsId: string, body: { password: string }) =>
    post<unknown>(`/api/public/client-login/${wsId}`, body),

  sharedPasswordAuth: (wsId: string, body: { password: string }) =>
    post<unknown>(`/api/public/auth/${wsId}`, body),

  clientUserLogin: (wsId: string, body: { email: string; password: string }) =>
    post<unknown>(`/api/public/client-login/${wsId}`, body),

  logout: (wsId: string) =>
    post<unknown>(`/api/public/client-logout/${wsId}`),

  forgotPassword: (wsId: string, body: { email: string }) =>
    post<unknown>(`/api/public/forgot-password/${wsId}`, body),

  resetPassword: (wsId: string, body: { token: string; password: string }) =>
    post<unknown>(`/api/public/reset-password/${wsId}`, body),

  verifyToken: () => get<unknown>('/api/public/verify-token'),
};

export const chatUsage = {
  get: (wsId: string) =>
    getSafe<{ allowed: boolean; used: number; limit: number; remaining: number; tier: string } | null>(`/api/public/chat-usage/${wsId}`, null),
};

export const roi = {
  get: (wsId: string) =>
    getSafe<{ organicTrafficValue?: number } | null>(`/api/public/roi/${wsId}`, null),
};
