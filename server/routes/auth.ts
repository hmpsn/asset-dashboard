/**
 * auth routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import express from 'express';
import { signToken, requireAuth } from '../auth.js';
import {
  loginLimiter,
  signAdminToken,
  verifyAdminToken,
  IS_PROD,
  APP_PASSWORD,
} from '../middleware.js';
import {
  createUser,
  verifyPassword,
  recordLogin,
  userCount,
} from '../users.js';
import { listWorkspaces } from '../workspaces.js';

router.post('/api/auth/login', loginLimiter, express.json(), (req, res) => {
  const { password } = req.body;
  if (!APP_PASSWORD) return res.json({ ok: true });
  if (password === APP_PASSWORD) {
    const token = signAdminToken();
    res.cookie('auth_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      secure: IS_PROD,
    });
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

router.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('auth_token');
  res.json({ ok: true });
});

router.get('/api/auth/check', (req, res) => {
  if (!APP_PASSWORD) return res.json({ required: false });
  const token = (req.headers['x-auth-token'] || req.cookies?.auth_token || '') as string;
  res.json({ required: true, authenticated: token === APP_PASSWORD || verifyAdminToken(token) });
});

// ── User-based JWT Auth ──

// Setup: create the first user (owner). Only works when no users exist.
router.post('/api/auth/setup', express.json(), async (req, res) => {
  try {
    if (userCount() > 0) return res.status(400).json({ error: 'Setup already completed. Use invite to add users.' });
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'email, password, and name are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    // First user gets all workspaces
    const allWs = listWorkspaces().map(w => w.id);
    const user = await createUser(email, password, name, 'owner', allWs);
    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, secure: IS_PROD });
    res.json({ user, token });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Check if setup is needed
router.get('/api/auth/setup-status', (_req, res) => {
  res.json({ needsSetup: userCount() === 0 });
});

// User login with email + password
router.post('/api/auth/user-login', loginLimiter, express.json(), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    const user = await verifyPassword(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    recordLogin(user.id);
    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, secure: IS_PROD });
    const { passwordHash: _pw, ...safe } = user;
    void _pw;
    res.json({ user: safe, token });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// User logout
router.post('/api/auth/user-logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// Get current authenticated user
router.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
