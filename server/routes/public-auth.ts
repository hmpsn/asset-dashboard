/**
 * public-auth routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import bcrypt from 'bcryptjs';
import {
  verifyClientPassword as verifyClientUserPassword,
  signClientToken,
  verifyClientToken,
  recordClientLogin,
  hasClientUsers,
  getSafeClientUser,
  createResetToken,
  resetPasswordWithToken,
} from '../client-users.js';
import { sendEmail } from '../email.js';
import { sanitizeString } from '../helpers.js';
import { signClientSession, clientLoginLimiter, IS_PROD } from '../middleware.js';
import { updateWorkspace, getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('public-auth');

router.post('/api/public/auth/:id', clientLoginLimiter, async (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  if (!ws.clientPassword) return res.json({ ok: true });
  const { password } = req.body;
  // Support both bcrypt hashes (new) and legacy plaintext (migration)
  const isHash = ws.clientPassword.startsWith('$2a$') || ws.clientPassword.startsWith('$2b$');
  const match = isHash
    ? await bcrypt.compare(password, ws.clientPassword)
    : password === ws.clientPassword;
  if (match) {
    // Migrate legacy plaintext password to bcrypt on successful login
    if (!isHash) {
      try { updateWorkspace(ws.id, { clientPassword: await bcrypt.hash(password, 12) }); } catch { /* best-effort migration */ }
    }
    // Issue signed session cookie for server-side verification
    const sessionToken = signClientSession(ws.id);
    res.cookie(`client_session_${ws.id}`, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: IS_PROD,
    });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Incorrect password' });
});

// --- Client User Auth (individual logins) ---

// Client user login (email + password, per workspace)
router.post('/api/public/client-login/:id', clientLoginLimiter, async (req, res) => {
  try {
    const ws = getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    const user = await verifyClientUserPassword(email, req.params.id, password);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    recordClientLogin(user.id);
    const { passwordHash: _pw, ...safe } = user;
    void _pw;
    const token = signClientToken(safe);
    // Also set the legacy session cookie so existing session middleware works
    const legacySessionToken = signClientSession(ws.id);
    res.cookie(`client_session_${ws.id}`, legacySessionToken, {
      httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000, secure: IS_PROD,
    });
    res.cookie(`client_user_token_${ws.id}`, token, {
      httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000, secure: IS_PROD,
    });
    res.json({ ok: true, user: safe, token });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get current client user from token
router.get('/api/public/client-me/:id', (req, res) => {
  const token = req.cookies?.[`client_user_token_${req.params.id}`];
  if (!token) return res.json({ user: null });
  const payload = verifyClientToken(token);
  if (!payload || payload.workspaceId !== req.params.id) return res.json({ user: null });
  const user = getSafeClientUser(payload.clientUserId);
  res.json({ user: user || null });
});

// Client user logout
router.post('/api/public/client-logout/:id', (_req, res) => {
  res.clearCookie(`client_user_token_${_req.params.id}`);
  res.clearCookie(`client_session_${_req.params.id}`);
  res.json({ ok: true });
});

// Workspace auth info: does this workspace use shared password, individual accounts, or both?
router.get('/api/public/auth-mode/:id', (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  res.json({
    hasSharedPassword: !!ws.clientPassword,
    hasClientUsers: hasClientUsers(req.params.id),
  });
});

// --- Password Reset ---

// Request password reset (sends email with reset link)
router.post('/api/public/forgot-password/:id', clientLoginLimiter, async (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const email = sanitizeString(req.body.email, 200)?.toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Always return success to prevent email enumeration
  const result = createResetToken(email, req.params.id);
  if (result) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${baseUrl}/client/${req.params.id}?reset_token=${result.token}`;
    const { renderDigest } = await import('../email-templates.js');
    const event = {
      type: 'password_reset' as const,
      recipient: email,
      workspaceId: req.params.id,
      workspaceName: ws.name,
      data: { resetUrl },
      createdAt: new Date().toISOString(),
    };
    const { subject, html } = renderDigest('password_reset', [event]);
    sendEmail(email, subject, html).catch(err => log.error({ err }, 'Email send failed'));
  }

  res.json({ ok: true, message: 'If an account with that email exists, a reset link has been sent.' });
});

// Complete password reset with token
router.post('/api/public/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
  const result = await resetPasswordWithToken(token, newPassword);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

// --- Portal Email Capture (shared-password visitors) ---
router.post('/api/public/capture-email/:id', (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const email = sanitizeString(req.body.email, 200)?.toLowerCase().trim();
  const name = sanitizeString(req.body.name, 100)?.trim() || undefined;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const contacts = ws.portalContacts || [];
  // Don't duplicate — update name if already exists
  const existing = contacts.find(c => c.email === email);
  if (existing) {
    if (name && !existing.name) existing.name = name;
  } else {
    contacts.push({ email, name, capturedAt: new Date().toISOString() });
  }

  updateWorkspace(ws.id, { portalContacts: contacts });
  res.json({ ok: true });
});

export default router;
