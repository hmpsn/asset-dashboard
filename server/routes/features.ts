import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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

export default router;
