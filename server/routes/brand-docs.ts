/**
 * Brand Docs — list, upload, and delete .txt/.md files from workspace brand-docs/ folder.
 * These files are read by readBrandDocs() in seo-context.ts and injected into all AI prompts.
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getUploadRoot } from '../data-dir.js';
import { getWorkspace } from '../workspaces.js';
import { upload } from '../middleware.js';

const router = Router();

function getBrandDocsDir(workspaceId: string): string | null {
  const ws = getWorkspace(workspaceId);
  if (!ws) return null;
  return path.join(getUploadRoot(), ws.folder, 'brand-docs');
}

// List brand docs
router.get('/api/brand-docs/:workspaceId', (req, res) => {
  const dir = getBrandDocsDir(req.params.workspaceId);
  if (!dir) return res.status(404).json({ error: 'Workspace not found' });

  if (!fs.existsSync(dir)) {
    return res.json({ files: [] });
  }

  try {
    const files = fs.readdirSync(dir)
      .filter(f => /\.(txt|md)$/i.test(f))
      .sort()
      .map(name => {
        const stat = fs.statSync(path.join(dir, name));
        return {
          name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      });
    res.json({ files });
  } catch {
    res.json({ files: [] });
  }
});

// Upload brand docs (multiple .txt/.md files)
router.post('/api/brand-docs/:workspaceId', upload.array('files', 10), (req, res) => {
  const dir = getBrandDocsDir(req.params.workspaceId);
  if (!dir) return res.status(404).json({ error: 'Workspace not found' });

  fs.mkdirSync(dir, { recursive: true });

  const uploaded: string[] = [];
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.txt' && ext !== '.md') {
      // Skip non-text files silently
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      continue;
    }
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(dir, safeName);
    fs.renameSync(file.path, dest);
    uploaded.push(safeName);
  }

  // List updated files
  const allFiles = fs.readdirSync(dir)
    .filter(f => /\.(txt|md)$/i.test(f))
    .sort()
    .map(name => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    });

  res.json({ uploaded, files: allFiles });
});

// Delete a brand doc
router.delete('/api/brand-docs/:workspaceId/:fileName', (req, res) => {
  const dir = getBrandDocsDir(req.params.workspaceId);
  if (!dir) return res.status(404).json({ error: 'Workspace not found' });

  const safeName = path.basename(req.params.fileName);
  const filePath = path.join(dir, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ deleted: safeName });
  } catch {
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;
