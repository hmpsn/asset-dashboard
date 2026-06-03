import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { validate, z } from '../middleware/validate.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';
import { parseJsonFallback } from '../db/json-validation.js';
import {
  getAllFlags,
  getAllFlagsWithMeta,
  getWorkspaceFlagsWithMeta,
  setFlagOverride,
  setWorkspaceFlagOverride,
} from '../feature-flags.js';
import { FEATURE_FLAGS } from '../../shared/types/feature-flags.js';
import type { FeatureFlagKey } from '../../shared/types/feature-flags.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FEATURES_FILE = path.join(__dirname, '..', '..', 'data', 'features.json');

router.get('/api/features', (_req, res) => {
  try {
    const raw = fs.readFileSync(FEATURES_FILE, 'utf-8');
    const data = parseJsonFallback(raw, null);
    if (!data) return res.status(500).json({ error: 'Failed to load features data' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load features data' });
  }
});

/** Returns resolved feature flag values for the current environment. */
router.get('/api/feature-flags', (_req, res) => {
  res.json(getAllFlags());
});

/** Returns all flags with source metadata. Admin-only — HMAC token required, JWT users rejected. */
router.get('/api/admin/feature-flags', requireAdminAuth, (_req, res) => {
  res.json(getAllFlagsWithMeta());
});

/** Set or clear a DB override for a single flag. Admin-only — HMAC token required, JWT users rejected. */
router.put(
  '/api/admin/feature-flags/:key',
  requireAdminAuth,
  validate(z.object({
    enabled: z.boolean().nullable(),
  })),
  (req, res) => {
    const { key } = req.params;
    if (!(key in FEATURE_FLAGS)) {
      return res.status(400).json({ error: `Unknown feature flag: ${key}` });
    }
    setFlagOverride(key as FeatureFlagKey, req.body.enabled);
    res.json({ success: true, key, enabled: req.body.enabled });
  },
);

/**
 * Per-workspace flag metadata (resolved value + source for THIS workspace, plus
 * the inherited/global value a clear would revert to). Admin-only — HMAC token
 * required, JWT users rejected (per CLAUDE.md Auth Conventions: requireAdminAuth,
 * NOT requireAuth — these manage canary rollout state, not workspace-member data).
 */
router.get(
  '/api/admin/workspaces/:workspaceId/feature-flags',
  requireAdminAuth,
  (req, res) => {
    res.json(getWorkspaceFlagsWithMeta(req.params.workspaceId));
  },
);

/**
 * Set or clear a PER-WORKSPACE override for a single flag. Body `{ enabled }`:
 *   - `true`  → force ON for this workspace only
 *   - `false` → force OFF for this workspace only
 *   - `null`  → clear the override (revert to global → env → default)
 *
 * Admin-only — HMAC token required, JWT users rejected. No broadcastToWorkspace:
 * the flag changes FUTURE generation/ranking behavior, not a live client surface,
 * so there is nothing to invalidate — the admin UI refetches the GET above.
 */
router.put(
  '/api/admin/workspaces/:workspaceId/feature-flags/:key',
  requireAdminAuth,
  validate(z.object({
    enabled: z.boolean().nullable(),
  })),
  (req, res) => {
    const { workspaceId, key } = req.params;
    if (!(key in FEATURE_FLAGS)) {
      return res.status(400).json({ error: `Unknown feature flag: ${key}` });
    }
    setWorkspaceFlagOverride(key as FeatureFlagKey, workspaceId, req.body.enabled);
    res.json({ success: true, workspaceId, key, enabled: req.body.enabled });
  },
);

export default router;
