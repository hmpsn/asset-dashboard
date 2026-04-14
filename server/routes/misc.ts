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
import type { execFileSync as ExecFileSyncFn } from 'child_process';
import { getUploadRoot } from '../data-dir.js';
import { getGA4TopPages } from '../google-analytics.js';
import { upload, moveUploadedFiles } from '../middleware.js';
import { triggerOptimize } from '../processor.js';
import { getAllGscPages } from '../search-console.js';
import { listSites, getPageDom } from '../webflow.js';
import {
  listWorkspaces,
  getWorkspace,
  getTokenForSite,
  getAllPageStates,
} from '../workspaces.js';
import { getWorkspacePages } from '../workspace-data.js';
import { createLogger } from '../logger.js';
import { isProgrammingError } from '../errors.js';

const log = createLogger('misc');

// GET all page states for a workspace (client/public)
router.get('/api/public/page-states/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  res.json(getAllPageStates(req.params.workspaceId));
});

// File upload
router.post('/api/upload/:workspaceId', upload.array('files'), (req, res) => {
  const files = req.files as Express.Multer.File[];
  const filePaths = moveUploadedFiles(files, req.params.workspaceId, false);

  broadcast('files:uploaded', {
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

router.post('/api/upload/:workspaceId/meta', upload.array('files'), (req, res) => {
  const files = req.files as Express.Multer.File[];
  const filePaths = moveUploadedFiles(files, req.params.workspaceId, true);

  broadcast('files:uploaded', {
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
router.get('/api/audit-traffic/:siteId', async (req, res) => {
  try {
    const allWs = listWorkspaces();
    const ws = allWs.find(w => w.webflowSiteId === req.params.siteId);
    if (!ws) return res.json({});

    const trafficMap: Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }> = {};

    // Fetch GSC page-level data
    if (ws.gscPropertyUrl) {
      try {
        const gscPages = await getAllGscPages(ws.id, ws.gscPropertyUrl, 28);
        for (const p of gscPages) {
          try {
            const path = new URL(p.page).pathname;
            if (!trafficMap[path]) trafficMap[path] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
            trafficMap[path].clicks += p.clicks;
            trafficMap[path].impressions += p.impressions;
          } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'misc: GET /api/audit-traffic/:siteId: programming error'); /* skip malformed URLs */ }
        }
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'misc: GET /api/audit-traffic/:siteId: programming error'); /* GSC unavailable */ }
    }

    // Fetch GA4 top pages
    if (ws.ga4PropertyId) {
      try {
        const ga4Pages = await getGA4TopPages(ws.ga4PropertyId, 28, 500);
        for (const p of ga4Pages) {
          const path = p.path.startsWith('/') ? p.path : `/${p.path}`;
          if (!trafficMap[path]) trafficMap[path] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
          trafficMap[path].pageviews += p.pageviews;
          trafficMap[path].sessions += p.users; // users as proxy for sessions at page level
        }
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'misc: programming error'); /* GA4 unavailable */ }
    }

    res.json(trafficMap);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Smart Naming (AI Vision Enhanced) ---
router.post('/api/smart-name', async (req, res) => {
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
          const smartNameWs = listWorkspaces().find(w => w.webflowSiteId === siteId);
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

    // Try vision-enhanced naming if we have an image URL
    let suggestion: string | null = null;
    if (imageUrl && !contentType?.includes('svg')) {
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
            model: 'gpt-4.1-nano',
            max_tokens: 60,
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

    // Fallback to text-only if vision didn't work
    if (!suggestion) {
      const response = await client.chat.completions.create({
        model: 'gpt-4.1-nano',
        max_tokens: 60,
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
router.post('/api/upload/:workspaceId/clipboard', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });

  const workspaces = listWorkspaces();
  const wsMatch = workspaces.find(w => w.id === req.params.workspaceId || w.folder === req.params.workspaceId);
  const destFolder = wsMatch ? path.join(getUploadRoot(), wsMatch.folder) : path.join(getUploadRoot(), '_unsorted');
  fs.mkdirSync(destFolder, { recursive: true });

  const originalName = req.body.fileName || file.originalname || `clipboard-${Date.now()}.png`;
  const targetPath = path.join(destFolder, originalName);

  try {
    // Resize to 2x for HDPI: halve dimensions so it's crisp at 2x
    const { execFileSync }: { execFileSync: typeof ExecFileSyncFn } = await import('child_process'); // dynamic-import-ok
    // Get current dimensions
    const sipsInfo = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file.path], { encoding: 'utf-8' });
    const widthMatch = sipsInfo.match(/pixelWidth:\s*(\d+)/);
    const heightMatch = sipsInfo.match(/pixelHeight:\s*(\d+)/);

    if (widthMatch && heightMatch) {
      const w = Math.round(parseInt(widthMatch[1]) / 2);
      const h = Math.round(parseInt(heightMatch[1]) / 2);
      execFileSync('sips', ['-z', String(h), String(w), file.path, '--out', targetPath], { stdio: 'pipe' });
    } else {
      fs.renameSync(file.path, targetPath);
    }
  } catch (err) {
    log.debug({ err }, 'misc: image resize via sips failed, falling back to move without resize');
    fs.renameSync(file.path, targetPath);
  }

  // Clean up temp file if still exists
  try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'misc: programming error'); /* ignore */ }

  broadcast('files:uploaded', {
    workspace: req.params.workspaceId,
    type: 'asset',
    count: 1,
    names: [originalName],
  });

  triggerOptimize(targetPath).catch(err => log.error({ err }, 'Optimize error'));
  res.json({ uploaded: 1, fileName: originalName });
});

export default router;
