import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { validate, z } from '../middleware/validate.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { getAllFlags, getAllFlagsWithMeta, setFlagOverride } from '../feature-flags.js';
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

/** Returns all flags with source metadata — admin only. */
router.get('/api/admin/feature-flags', (_req, res) => {
  res.json(getAllFlagsWithMeta());
});

/** Set or clear a DB override for a single flag — admin only. */
router.put(
  '/api/admin/feature-flags/:key',
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

export default router;
