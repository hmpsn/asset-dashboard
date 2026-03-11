/**
 * roadmap routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDataDir } from '../data-dir.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Roadmap Persistence ---
const ROADMAP_RUNTIME_FILE = path.join(getDataDir('admin'), 'roadmap.json');
const ROADMAP_REPO_FILE = path.join(__dirname, '..', '..', 'data', 'roadmap.json');
const ROADMAP_STATUS_FILE = path.join(getDataDir('admin'), 'roadmap-status.json');

function loadRoadmap() {
  let repoNewer = false;
  try {
    if (fs.existsSync(ROADMAP_REPO_FILE) && fs.existsSync(ROADMAP_RUNTIME_FILE)) {
      const repoMtime = fs.statSync(ROADMAP_REPO_FILE).mtimeMs;
      const runtimeMtime = fs.statSync(ROADMAP_RUNTIME_FILE).mtimeMs;
      if (repoMtime > runtimeMtime) {
        repoNewer = true;
        const repoData = JSON.parse(fs.readFileSync(ROADMAP_REPO_FILE, 'utf-8'));
        const runtimeData = JSON.parse(fs.readFileSync(ROADMAP_RUNTIME_FILE, 'utf-8'));
        const runtimeStatuses: Record<string, string> = {};
        for (const sprint of runtimeData.sprints || []) {
          for (const item of sprint.items || []) {
            runtimeStatuses[String(item.id)] = item.status;
          }
        }
        for (const sprint of repoData.sprints || []) {
          for (const item of sprint.items || []) {
            const rtStatus = runtimeStatuses[String(item.id)];
            if (rtStatus && rtStatus !== item.status) {
              const priority: Record<string, number> = { pending: 0, in_progress: 1, done: 2 };
              item.status = (priority[rtStatus] ?? 0) >= (priority[item.status] ?? 0) ? rtStatus : item.status;
            }
          }
        }
        fs.writeFileSync(ROADMAP_RUNTIME_FILE, JSON.stringify(repoData, null, 2));
        return repoData;
      }
    }
  } catch { /* fall through to normal load */ }

  if (!repoNewer) {
    try {
      if (fs.existsSync(ROADMAP_RUNTIME_FILE)) {
        return JSON.parse(fs.readFileSync(ROADMAP_RUNTIME_FILE, 'utf-8'));
      }
    } catch { /* fall through */ }
  }

  let data: ReturnType<typeof JSON.parse> | null = null;
  try {
    if (fs.existsSync(ROADMAP_REPO_FILE)) {
      data = JSON.parse(fs.readFileSync(ROADMAP_REPO_FILE, 'utf-8'));
    }
  } catch { /* fall through */ }

  if (!data) {
    data = { sprints: [] };
  }

  if (fs.existsSync(ROADMAP_STATUS_FILE)) {
    try {
      const statuses = JSON.parse(fs.readFileSync(ROADMAP_STATUS_FILE, 'utf-8')) as Record<string, string>;
      for (const sprint of data.sprints) {
        for (const item of sprint.items) {
          if (statuses[String(item.id)]) item.status = statuses[String(item.id)];
        }
      }
    } catch { /* ignore */ }
  }

  fs.writeFileSync(ROADMAP_RUNTIME_FILE, JSON.stringify(data, null, 2));
  return data;
}

// GET full roadmap (sprints + items + statuses)
router.get('/api/roadmap', (_req, res) => {
  res.json(loadRoadmap());
});

// PUT full roadmap (replace entire structure)
router.put('/api/roadmap', (req, res) => {
  try {
    fs.writeFileSync(ROADMAP_RUNTIME_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// PATCH single item status (lightweight update)
router.patch('/api/roadmap/item/:id', (req, res) => {
  try {
    const data = loadRoadmap();
    const itemId = parseInt(req.params.id, 10);
    for (const sprint of data.sprints) {
      const item = sprint.items.find((i: { id: number }) => i.id === itemId);
      if (item) {
        Object.assign(item, req.body);
        fs.writeFileSync(ROADMAP_RUNTIME_FILE, JSON.stringify(data, null, 2));
        return res.json({ ok: true, item });
      }
    }
    res.status(404).json({ error: 'Item not found' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Legacy compat: GET /api/roadmap-status returns flat status map
router.get('/api/roadmap-status', (_req, res) => {
  try {
    const data = loadRoadmap();
    const statusMap: Record<string, string> = {};
    for (const sprint of data.sprints) {
      for (const item of sprint.items) statusMap[String(item.id)] = item.status;
    }
    res.json(statusMap);
  } catch { res.json({}); }
});

export default router;
