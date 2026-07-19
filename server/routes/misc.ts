/**
 * misc routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import fs from 'fs';
import path from 'path';
import { broadcast } from '../broadcast.js';
import type * as OpenAIMod from 'openai';
import type { default as SharpConstructor } from 'sharp';
import { getUploadRoot } from '../data-dir.js';
import { getAuditTrafficForWorkspace } from '../audit-traffic.js';
import { upload, moveUploadedFiles, requireClientPortalAuth } from '../middleware.js';
import { triggerOptimize } from '../processor.js';
import { listSites, getPageDom } from '../webflow.js';
import { getAllPageStates, getTokenForSite, getWorkspace, getWorkspaceBySiteId, listWorkspaces } from '../workspaces.js';
import { getWorkspacePages } from '../workspace-data.js';
import { suggestSvgFilename } from '../domains/webflow-assets/svg-naming.js';
import { createLogger } from '../logger.js';
import { isProgrammingError } from '../errors.js';
import { requireWorkspaceAccess, requireWorkspaceSiteAccess, requireWorkspaceSiteAccessFromQuery } from '../auth.js';
import { sanitizeFileName } from '../path-safety.js';

const log = createLogger('misc');

// GET all page states for a workspace (client/public)
router.get('/api/public/page-states/:workspaceId', requireClientPortalAuth(), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  res.json(getAllPageStates(req.params.workspaceId));
});

// File upload
router.post('/api/upload/:workspaceId', requireWorkspaceAccess('workspaceId'), upload.array('files'), (req, res) => {
  const files = req.files as Express.Multer.File[];
  const filePaths = moveUploadedFiles(files, req.params.workspaceId, false);

  broadcast('files:uploaded', { // ws-event-ok
    workspace: req.params.workspaceId,
    type: 'asset',
    count: files.length,
    names: files.map(f => f.originalname),
  });

  for (const fp of filePaths) {
    triggerOptimize(fp).catch(err => log.error({ err }, 'Optimize error'));
  }

  res.json({ uploaded: files.length });
});

router.post('/api/upload/:workspaceId/meta', requireWorkspaceAccess('workspaceId'), upload.array('files'), (req, res) => {
  const files = req.files as Express.Multer.File[];
  const filePaths = moveUploadedFiles(files, req.params.workspaceId, true);

  broadcast('files:uploaded', { // ws-event-ok
    workspace: req.params.workspaceId,
    type: 'meta',
    count: files.length,
    names: files.map(f => f.originalname),
  });

  for (const fp of filePaths) {
    triggerOptimize(fp).catch(err => log.error({ err }, 'Optimize error'));
  }

  res.json({ uploaded: files.length });
});

// --- Audit Traffic Context (cross-reference audit pages with GSC/GA4 traffic) ---
router.get('/api/audit-traffic/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  try {
    const ws = getWorkspaceBySiteId(req.params.siteId);
    if (!ws) return res.json({});
    const trafficMap = await getAuditTrafficForWorkspace(ws);
    return res.json(trafficMap);
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'misc: GET /api/audit-traffic/:siteId: top-level programming error'); // url-fetch-ok
    else log.debug({ err }, 'misc: audit-traffic endpoint failed — degrading gracefully');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Smart Naming (AI Vision Enhanced) ---
router.post('/api/smart-name', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'body', name: 'siteId' },
}), async (req, res) => {
  const { originalName, altText, pageTitle, contentType, imageUrl, siteId, assetId } = req.body;
  if (!originalName) return res.status(400).json({ error: 'originalName required' });

  try {
    const OpenAI: typeof OpenAIMod.default = (await import('openai')).default; // dynamic-import-ok
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const ext = originalName.split('.').pop()?.toLowerCase() || 'jpg';
    const contextParts: string[] = [];
    if (altText) contextParts.push(`Alt text: "${altText}"`);
    if (pageTitle) contextParts.push(`Used on page: "${pageTitle}"`);
    if (contentType) contextParts.push(`Type: ${contentType}`);

    // Fetch site name + scan pages for usage context
    if (siteId) {
      try {
        const tkn = getTokenForSite(siteId) || undefined;
        const sites = await listSites(tkn);
        const site = sites.find(s => s.id === siteId);
        if (site) contextParts.push(`Website: "${site.displayName}"`);

        // Scan pages to find where this asset is used
        if (assetId || imageUrl) {
          const smartNameWs = getWorkspaceBySiteId(siteId);
          const pages = smartNameWs ? await getWorkspacePages(smartNameWs.id, siteId) : [];
          const usedOnPages: string[] = [];
          for (const page of pages.slice(0, 15)) {
            try {
              const dom = await getPageDom(page.id, tkn);
              const matchId = assetId && dom.includes(assetId);
              const matchUrl = imageUrl && dom.includes(imageUrl);
              if (matchId || matchUrl) {
                // Extract surrounding text for context
                const plainText = dom.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                const needle = assetId || imageUrl.split('/').pop() || '';
                const idx = plainText.indexOf(needle);
                if (idx !== -1) {
                  const start = Math.max(0, idx - 120);
                  const snippet = plainText.slice(start, start + 250).trim();
                  usedOnPages.push(`Page "${page.title}": ...${snippet}...`);
                } else {
                  usedOnPages.push(`Page "${page.title}"`);
                }
                if (usedOnPages.length >= 3) break;
              }
            } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'misc: programming error'); /* skip page */ }
          }
          if (usedOnPages.length > 0) {
            contextParts.push(`Used on these pages:\n${usedOnPages.join('\n')}`);
          }
        }
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'misc: programming error'); /* skip context fetch */ }
    }

    const promptText = `Suggest an SEO-friendly filename for this web image.
Current name: "${originalName}"
${contextParts.length > 0 ? contextParts.join('\n') : ''}

Rules:
- lowercase, hyphens between words, no special chars
- Descriptive and specific to what the image shows
- 3-5 words max, do NOT include the file extension
- Prioritize what the image actually depicts over generic terms
- Include brand/business name if visible in the image
Just output the filename slug, nothing else.`;

    const isSvg = contentType?.includes('svg') || ext === 'svg';

    // Try content-enhanced naming if we have an image URL.
    let suggestion: string | null = null;
    if (imageUrl && isSvg) {
      // SVGs are XML, not pixels — a vision model can't "see" them, so the old code
      // skipped straight to filename-only naming and produced generic guesses. Feed
      // the SVG SOURCE instead so the model can derive a real, specific name.
      try {
        suggestion = await suggestSvgFilename(client, imageUrl, promptText);
      } catch (sErr) {
        log.info({ detail: sErr instanceof Error ? sErr.message : sErr }, 'SVG naming fallback to text-only');
      }
    } else if (imageUrl) {
      try {
        // Download and prepare image for vision
        const sharp: typeof SharpConstructor = (await import('sharp')).default; // dynamic-import-ok
        const imgRes = await fetch(imageUrl);
        if (imgRes.ok) {
          const imgBuf = Buffer.from(await imgRes.arrayBuffer());
          const smallBuf = await sharp(imgBuf)
            .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 50 })
            .toBuffer();
          const base64 = smallBuf.toString('base64');

          const visionRes = await client.chat.completions.create({
            model: 'gpt-5.4-nano',
            max_completion_tokens: 60,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
                { type: 'text', text: promptText },
              ],
            }],
          });
          suggestion = visionRes.choices[0]?.message?.content?.trim() || null;
        }
      } catch (vErr) {
        log.info({ detail: vErr instanceof Error ? vErr.message : vErr }, 'Vision naming fallback to text-only');
      }
    }

    // Fallback to text-only if the content-enhanced attempt didn't produce a name
    if (!suggestion) {
      const response = await client.chat.completions.create({
        model: 'gpt-5.4-nano',
        max_completion_tokens: 60,
        messages: [{ role: 'user', content: promptText }],
      });
      suggestion = response.choices[0]?.message?.content?.trim() || originalName.replace(/\.[^.]+$/, '');
    }

    // Clean up: remove quotes, extension if accidentally included, ensure valid slug
    const raw = suggestion || originalName.replace(/\.[^.]+$/, '');
    suggestion = raw.replace(/['"]/g, '').replace(/\.[a-z]+$/i, '').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    res.json({ suggestion, extension: ext, fullName: `${suggestion}.${ext}` });
  } catch (e) {
    log.error({ err: e }, 'Smart name error');
    res.status(500).json({ error: 'Failed to generate name' });
  }
});

// --- Clipboard Upload (with HDPI 2x resize) ---
router.post('/api/upload/:workspaceId/clipboard', requireWorkspaceAccess('workspaceId'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });

  // id → single-row helper; folder fallback has no index helper.
  const wsMatch = getWorkspace(req.params.workspaceId)
    ?? listWorkspaces().find(w => w.folder === req.params.workspaceId); // list-workspaces-find-ok: folder has no index; id path is the helper above
  const destFolder = wsMatch ? path.join(getUploadRoot(), wsMatch.folder) : path.join(getUploadRoot(), '_unsorted');
  fs.mkdirSync(destFolder, { recursive: true });

  const fallbackName = `clipboard-${Date.now()}.png`;
  const originalName = sanitizeFileName(req.body.fileName || file.originalname, fallbackName);
  const targetPath = path.join(destFolder, originalName);

  try {
    // Resize to 2x for HDPI: halve dimensions so it's crisp at 2x
    const sharp: typeof SharpConstructor = (await import('sharp')).default; // dynamic-import-ok
    const image = sharp(file.path);
    const metadata = await image.metadata();
    if (metadata.width && metadata.height) {
      await image
        .resize(Math.round(metadata.width / 2), Math.round(metadata.height / 2), { fit: 'inside', withoutEnlargement: true })
        .toFile(targetPath);
    } else {
      fs.renameSync(file.path, targetPath);
    }
  } catch (err) {
    log.debug({ err }, 'misc: clipboard image resize failed, falling back to move without resize');
    fs.renameSync(file.path, targetPath);
  }

  // Clean up temp file if still exists
  try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'misc: programming error'); /* ignore */ }

  broadcast('files:uploaded', { // ws-event-ok
    workspace: req.params.workspaceId,
    type: 'asset',
    count: 1,
    names: [originalName],
  });

  triggerOptimize(targetPath).catch(err => log.error({ err }, 'Optimize error'));
  res.json({ uploaded: 1, fileName: originalName });
});

export default router;
