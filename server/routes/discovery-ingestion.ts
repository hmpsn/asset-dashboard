import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
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
import type { SourceType, ExtractionStatus, ExtractionDestination } from '../../shared/types/brand-engine.js';

const router = Router();

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

    const sourceType = (req.body.sourceType || 'brand_doc') as SourceType;
    const sources = [];

    for (const file of files) {
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ext !== 'txt' && ext !== 'md') continue;

      if (!file.path) continue;

      let content: string;
      try {
        content = fs.readFileSync(file.path, 'utf-8');
        fs.unlinkSync(file.path);
      } catch {
        continue;
      }

      const source = addSource(req.params.workspaceId, file.originalname, sourceType, content);
      sources.push(source);
    }

    if (sources.length > 0) {
      addActivity(req.params.workspaceId, 'discovery_source_added', `Added ${sources.length} discovery source${sources.length > 1 ? 's' : ''}`);
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.DISCOVERY_UPDATED, { added: sources.length });
    }

    res.json({ sources });
  },
);

// Upload source from pasted text — MUST be before /:id routes to avoid shadowing
router.post('/api/discovery/:workspaceId/sources/text', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { filename, sourceType, rawContent } = req.body;
  if (!rawContent) return res.status(400).json({ error: 'rawContent required' });
  const source = addSource(req.params.workspaceId, filename || 'pasted-text.txt', (sourceType || 'brand_doc') as SourceType, rawContent);
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
router.patch('/api/discovery/:workspaceId/extractions/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { status, routedTo, content } = req.body;
  if (content !== undefined) {
    updateExtractionContent(req.params.workspaceId, req.params.id, content);
  }
  if (status) {
    updateExtractionStatus(
      req.params.workspaceId, req.params.id,
      status as ExtractionStatus,
      routedTo as ExtractionDestination | undefined,
    );
  }
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.DISCOVERY_UPDATED, { extractionId: req.params.id });
  res.json({ updated: true });
});

export default router;
