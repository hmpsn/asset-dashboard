/**
 * users routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import express from 'express';
import { requireAuth, requireRole } from '../auth.js';
import {
  createUser,
  listUsers,
  getSafeUser,
  updateUser,
  changePassword,
  deleteUser,
} from '../users.js';

// ── User Management (admin/owner only) ──

router.get('/api/users', requireAuth, requireRole('owner', 'admin'), (_req, res) => {
  res.json(listUsers());
});

router.get('/api/users/:id', requireAuth, requireRole('owner', 'admin'), (req, res) => {
  const user = getSafeUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Invite / create a new user
router.post('/api/users', requireAuth, requireRole('owner', 'admin'), express.json(), async (req, res) => {
  try {
    const { email, password, name, role, workspaceIds } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'email, password, and name are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    // Only owner can create admin/owner users
    const callerRole = req.user!.role;
    if ((role === 'owner' || role === 'admin') && callerRole !== 'owner') {
      return res.status(403).json({ error: 'Only owners can create admin users' });
    }
    const user = await createUser(email, password, name, role || 'member', workspaceIds || []);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Update a user
router.patch('/api/users/:id', requireAuth, requireRole('owner', 'admin'), express.json(), async (req, res) => {
  try {
    const { name, email, role, workspaceIds, avatarUrl } = req.body;
    // Only owner can change roles to admin/owner
    if ((role === 'owner' || role === 'admin') && req.user!.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can assign admin roles' });
    }
    const user = await updateUser(req.params.id, { name, email, role, workspaceIds, avatarUrl });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Change password (self or admin)
router.post('/api/users/:id/password', requireAuth, express.json(), async (req, res) => {
  try {
    const targetId = req.params.id;
    const isSelf = req.user!.id === targetId;
    const isAdmin = req.user!.role === 'owner' || req.user!.role === 'admin';
    if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Insufficient permissions' });
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const ok = await changePassword(targetId, password);
    if (!ok) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete a user
router.delete('/api/users/:id', requireAuth, requireRole('owner'), (req, res) => {
  if (req.params.id === req.user!.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const ok = deleteUser(req.params.id);
  if (!ok) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

export default router;
