/**
 * LLMs.txt Generator routes.
 *
 * POST /api/llms-txt/:workspaceId/generate    — enqueue generation job; returns { jobId }
 * GET  /api/llms-txt/:workspaceId             — return last stored result (JSON) without re-generating
 * GET  /api/llms-txt/:workspaceId/download    — download stored llms.txt (index)
 * GET  /api/llms-txt/:workspaceId/download-full — download stored llms-full.txt
 * GET  /api/llms-txt/:workspaceId/freshness   — return last generation timestamp (fast)
 *
 * Generation is async: use POST /generate to kick off a new run (returns { jobId }),
 * then poll GET /api/jobs/:jobId for status. GET endpoints serve the stored result
 * persisted by the job runner — they do NOT trigger a fresh crawl or AI generation.
 * If no result has been stored yet, they return 404.
 */
import { Router } from 'express';
import { getStoredResult, getLastGenerated } from '../llms-txt-generator.js';
import { createLogger } from '../logger.js';
import { requireWorkspaceAccess } from '../auth.js';
import { getWorkspace } from '../workspaces.js';
import { createJob } from '../jobs.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { runLlmsTxtGenerationJob } from '../llms-txt-generation-job.js';

const log = createLogger('routes:llms-txt');
const router = Router();

// ── IMPORTANT: specific paths before param routes ─────────────────────────────

// POST /api/llms-txt/:workspaceId/generate — enqueue async generation
// Returns { jobId }; poll /api/jobs/:jobId for progress + result.
router.post('/api/llms-txt/:workspaceId/generate', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId } = req.params;
  if (!getWorkspace(workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
  const job = createJob(BACKGROUND_JOB_TYPES.LLMS_TXT_GENERATION, { workspaceId });
  setImmediate(() => {
    void runLlmsTxtGenerationJob({ jobId: job.id, workspaceId });
  });
  return res.json({ jobId: job.id });
});

// GET /api/llms-txt/:workspaceId/freshness — last generation timestamp (fast, no re-gen)
router.get('/api/llms-txt/:workspaceId/freshness', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const lastGeneratedAt = getLastGenerated(req.params.workspaceId);
    res.json({ lastGeneratedAt });
  } catch (err) {
    log.error({ err }, 'Failed to get LLMs.txt freshness');
    res.status(500).json({ error: 'Failed to get freshness' });
  }
});

// GET /api/llms-txt/:workspaceId/download — serve stored llms.txt (index).
// Returns 404 if no generation has completed yet. Does NOT trigger a fresh crawl.
router.get('/api/llms-txt/:workspaceId/download', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const result = getStoredResult(req.params.workspaceId);
  if (!result) return res.status(404).json({ error: 'No LLMs.txt has been generated yet. Use POST /generate to kick off generation.' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="llms.txt"');
  res.send(result.content);
});

// GET /api/llms-txt/:workspaceId/download-full — serve stored llms-full.txt.
// Returns 404 if no generation has completed yet. Does NOT trigger a fresh crawl.
router.get('/api/llms-txt/:workspaceId/download-full', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const result = getStoredResult(req.params.workspaceId);
  if (!result) return res.status(404).json({ error: 'No LLMs.txt has been generated yet. Use POST /generate to kick off generation.' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="llms-full.txt"');
  res.send(result.fullContent);
});

// GET /api/llms-txt/:workspaceId — return last stored result as JSON.
// Returns 404 if no generation has completed yet. Does NOT trigger a fresh crawl.
router.get('/api/llms-txt/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const result = getStoredResult(req.params.workspaceId);
  if (!result) return res.status(404).json({ error: 'No LLMs.txt has been generated yet. Use POST /generate to kick off generation.' });
  res.json(result);
});

export default router;
