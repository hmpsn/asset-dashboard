import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getAllFlags } from '../feature-flags.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FEATURES_FILE = path.join(__dirname, '..', '..', 'data', 'features.json');

router.get('/api/features', (_req, res) => {
  try {
    const raw = fs.readFileSync(FEATURES_FILE, 'utf-8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load features data' });
  }
});

/** Returns resolved feature flag values for the current environment. */
router.get('/api/feature-flags', (_req, res) => {
  res.json(getAllFlags());
});

export default router;
