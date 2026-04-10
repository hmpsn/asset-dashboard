import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import { upload } from '../middleware.js';
import fs from 'fs';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  listSources, addSource, deleteSource, processSource,
  listExtractions, listExtractionsBySource,
  updateExtractionStatus, updateExtractionContent,
} from '../discovery-ingestion.js';

const router = Router();

// ── Zod schemas ─────────────────────────────────────────────────────────────

const sourceTypeSchema = z.enum(['transcript', 'brand_doc', 'competitor', 'existing_copy', 'website_crawl']);
const extractionStatusSchema = z.enum(['pending', 'accepted', 'dismissed']);
const extractionDestinationSchema = z.enum(['voice_profile', 'brandscript', 'identity']);

const pasteSourceSchema = z.object({
  filename: z.string().optional(),
  sourceType: sourceTypeSchema.optional().default('brand_doc'),
  rawContent: z.string().min(1),
});

const patchExtractionSchema = z.object({
  status: extractionStatusSchema.optional(),
  routedTo: extractionDestinationSchema.optional(),
  content: z.string().min(1).optional(),
}).refine(
  (v) => v.status !== undefined || v.content !== undefined,
  { message: 'At least one of `content` or `status` is required' },
);

// List sources
router.get('/api/discovery/:workspaceId/sources', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listSources(req.params.workspaceId));
});

// Upload source file(s) — disk-based multer, read from file.path
router.post('/api/discovery/:workspaceId/sources',
  requireWorkspaceAccess('workspaceId'),
  upload.array('files', 10),
  (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) return res.status(400).json({ error: 'No files uploaded' });

    // Multipart form field — validated inline rather than via `validate()`
    // because the `validate()` middleware runs before multer populates req.body.
    const sourceTypeInput = typeof req.body.sourceType === 'string' ? req.body.sourceType : 'brand_doc';
    const parsed = sourceTypeSchema.safeParse(sourceTypeInput);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid sourceType' });
    const sourceType = parsed.data;
    const sources = [];
    const rejected: { filename: string; reason: string }[] = [];

    for (const file of files) {
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'txt' && ext !== 'md') {
        // Clean up disk temp file for rejected types — multer doesn't auto-delete
        if (file.path) { try { fs.unlinkSync(file.path); } catch { /* ignore cleanup errors */ } }
        rejected.push({ filename: file.originalname, reason: 'Unsupported file type (only .txt and .md are accepted)' });
        continue;
      }

      if (!file.path) {
        rejected.push({ filename: file.originalname, reason: 'Upload failed — no file path' });
        continue;
      }

      let content: string;
      try {
        content = fs.readFileSync(file.path, 'utf-8');
        fs.unlinkSync(file.path);
      } catch {
        rejected.push({ filename: file.originalname, reason: 'Could not read uploaded file' });
        continue;
      }

      const source = addSource(req.params.workspaceId, file.originalname, sourceType, content);
      sources.push(source);
    }

    if (sources.length > 0) {
      addActivity(req.params.workspaceId, 'discovery_source_added', `Added ${sources.length} discovery source${sources.length > 1 ? 's' : ''}`);
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.DISCOVERY_UPDATED, { added: sources.length });
    }

    // If every file was rejected, surface a 400 so the client sees a hard failure.
    if (sources.length === 0 && rejected.length > 0) {
      return res.status(400).json({
        error: 'No files were accepted',
        rejected,
      });
    }

    res.json({ sources, rejected });
  },
);

// Upload source from pasted text — MUST be before /:id routes to avoid shadowing
router.post('/api/discovery/:workspaceId/sources/text', requireWorkspaceAccess('workspaceId'), validate(pasteSourceSchema), (req, res) => {
  const { filename, sourceType, rawContent } = req.body;
  const source = addSource(req.params.workspaceId, filename || 'pasted-text.txt', sourceType, rawContent);
  addActivity(req.params.workspaceId, 'discovery_source_added', `Added discovery source "${source.filename}"`);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.DISCOVERY_UPDATED, { sourceId: source.id });
  res.json(source);
});

// Delete source
router.delete('/api/discovery/:workspaceId/sources/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ok = deleteSource(req.params.workspaceId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  addActivity(req.params.workspaceId, 'discovery_source_deleted', 'Deleted discovery source');
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.DISCOVERY_UPDATED, { sourceId: req.params.id, deleted: true });
  res.json({ deleted: true });
});

// Process source (AI extraction)
router.post('/api/discovery/:workspaceId/sources/:id/process', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const extractions = await processSource(req.params.workspaceId, req.params.id);
    addActivity(req.params.workspaceId, 'discovery_processed', `Extracted ${extractions.length} insight${extractions.length !== 1 ? 's' : ''} from discovery source`);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.DISCOVERY_UPDATED, { sourceId: req.params.id, extractionCount: extractions.length });
    res.json({ extractions });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Processing failed' });
  }
});

// List all extractions for workspace
router.get('/api/discovery/:workspaceId/extractions', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listExtractions(req.params.workspaceId));
});

// List extractions for a specific source
router.get('/api/discovery/:workspaceId/sources/:id/extractions', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listExtractionsBySource(req.params.id));
});

// Update extraction status (accept/dismiss) and/or content (edit)
router.patch('/api/discovery/:workspaceId/extractions/:id', requireWorkspaceAccess('workspaceId'), validate(patchExtractionSchema), (req, res) => {
  const { status, routedTo, content } = req.body;

  let touched = false;
  if (content !== undefined) {
    const ok = updateExtractionContent(req.params.workspaceId, req.params.id, content);
    if (!ok) return res.status(404).json({ error: 'Extraction not found' });
    touched = true;
  }
  if (status) {
    const ok = updateExtractionStatus(req.params.workspaceId, req.params.id, status, routedTo);
    if (!ok) return res.status(404).json({ error: 'Extraction not found' });
    touched = true;
  }

  if (touched) {
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.DISCOVERY_UPDATED, { extractionId: req.params.id });
  }
  res.json({ updated: touched });
});

export default router;
