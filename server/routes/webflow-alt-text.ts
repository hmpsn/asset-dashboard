/**
 * AI alt text generation & image compression routes — extracted from webflow.ts
 *
 * @reads workspaces, workspace_pages, webflow_api, cms_items, usage_tracking, workspace_intelligence
 * @writes webflow_assets, cms_items, usage_tracking
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireWorkspaceAccess, requireWorkspaceSiteAccess } from '../auth.js';
import { generateAltText } from '../alttext.js';
import { buildIntelPrompt } from '../workspace-intelligence.js';
import {
  listSites,
  updateAsset,
  getPageDom,
} from '../webflow.js';
import type { CmsImageUsage } from '../../shared/types/cms-images.ts';
import {
  getWorkspace,
  getTokenForSite,
} from '../workspaces.js';
import { getWorkspacePages } from '../workspace-data.js';
import {
  compressImageBuffer,
  replaceCompressedAsset,
} from '../domains/webflow-assets/image-optimization.js';
import { createLogger } from '../logger.js';
import { isProgrammingError } from '../errors.js';
import { checkUsageLimit, incrementIfAllowed, decrementUsage } from '../usage-tracking.js';
import { fetchExternalBytes, isExternalFetchError } from '../external-fetch.js';

const log = createLogger('webflow-alt-text');

const router = Router();

// --- AI Alt Text Generation for existing assets ---
router.post('/api/webflow/:workspaceId/generate-alt/:assetId', requireWorkspaceAccess('workspaceId'), requireWorkspaceSiteAccess({
  workspace: { source: 'params', name: 'workspaceId' },
  site: { source: 'body', name: 'siteId' },
}), async (req, res) => {
  const { imageUrl, siteId } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!incrementIfAllowed(ws.id, ws.tier || 'free', 'alt_text_generations')) {
    return res.status(429).json({ error: 'Monthly AI generation limit reached' });
  }

  try {
    let context = '';
    if (siteId) {
      try {
        const tkn = getTokenForSite(siteId) || undefined;
        const pages = await getWorkspacePages(req.params.workspaceId, siteId);
        const assetId = req.params.assetId;
        const contextParts: string[] = [];

        for (const page of pages.slice(0, 20)) {
          try {
            const dom = await getPageDom(page.id, tkn);
            if (dom.includes(assetId) || dom.includes(imageUrl)) {
              const plainText = dom.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              const idx = plainText.indexOf(assetId) !== -1
                ? plainText.indexOf(assetId)
                : plainText.indexOf(imageUrl.split('/').pop() || '');
              const start = Math.max(0, idx - 100);
              const snippet = plainText.slice(start, start + 200).trim();
              contextParts.push(`Page "${page.title}": ${snippet}`);
              if (contextParts.length >= 2) break;
            }
          } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-alt-text: POST /api/webflow/generate-alt/:assetId: programming error'); /* skip */ }
        }

        if (contextParts.length > 0) {
          context = contextParts.join('\n');
        } else {
          const sites = await listSites(tkn);
          const site = sites.find(s => s.id === siteId);
          if (site) context = `Website: ${site.displayName}`;
        }
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-alt-text: POST /api/webflow/generate-alt/:assetId: programming error'); /* proceed without context */ }
    }

    const bytes = await fetchExternalBytes({
      url: imageUrl,
      timeoutMs: 15_000,
      redirect: 'follow',
      urlSafety: 'public-web',
      logContext: { module: 'webflow-alt-text', fetchPath: 'single-alt-image' },
    });
    const buffer = Buffer.from(bytes);
    const ext = path.extname(imageUrl).split('?')[0] || '.jpg';
    const tmpPath = `/tmp/alt_gen_${Date.now()}${ext}`;
    fs.writeFileSync(tmpPath, buffer);

    let altText: string | null = null;
    try {
      {
        const altIntelContext = await buildIntelPrompt(req.params.workspaceId, ['seoContext'], {
          verbosity: 'compact',
          tokenBudget: 650,
        });
        if (altIntelContext) {
          context = context ? `${context}\n${altIntelContext}` : altIntelContext;
        }
      }

      altText = await generateAltText(tmpPath, context || undefined);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-alt-text: tmp unlink failed'); }
    }

    if (altText) {
      const altToken = siteId ? (getTokenForSite(siteId) || undefined) : undefined;
      const writeResult = await updateAsset(req.params.assetId, { altText }, altToken);
      if (!writeResult.success) {
        log.error({ detail: writeResult.error }, `Alt text generated but Webflow write-back failed for ${req.params.assetId}:`);
        decrementUsage(ws.id, 'alt_text_generations');
        res.json({ altText, updated: false, writeError: writeResult.error });
      } else {
        log.info(`Alt text generated and saved for ${req.params.assetId}: "${altText}"`);
        res.json({ altText, updated: true });
      }
    } else {
      log.warn(`Alt text generation returned null for ${req.params.assetId}`);
      decrementUsage(ws.id, 'alt_text_generations');
      res.json({ altText: null, updated: false });
    }
  } catch (e) {
    log.error({ err: e }, 'Generate alt error');
    decrementUsage(ws.id, 'alt_text_generations');
    res.status(500).json({ error: 'Failed to generate alt text' });
  }
});

// --- Bulk AI Alt Text Generation (fetches context once) ---
router.post('/api/webflow/:workspaceId/bulk-generate-alt', requireWorkspaceAccess('workspaceId'), requireWorkspaceSiteAccess({
  workspace: { source: 'params', name: 'workspaceId' },
  site: { source: 'body', name: 'siteId' },
}), async (req, res) => {
  const { assets, siteId } = req.body as {
    assets: Array<{ assetId: string; imageUrl: string }>;
    siteId?: string;
  };
  if (!assets?.length) return res.status(400).json({ error: 'assets required' });

  const token = siteId ? (getTokenForSite(siteId) || undefined) : undefined;

  const bulkWs = getWorkspace(req.params.workspaceId);
  if (!bulkWs) return res.status(404).json({ error: 'Workspace not found' });
  const usage = checkUsageLimit(bulkWs.id, bulkWs.tier || 'free', 'alt_text_generations');
  if (!usage.allowed) return res.status(429).json({ error: 'Monthly AI generation limit reached', used: usage.used, limit: usage.limit });

  let siteContext = '';
  if (siteId) {
    try {
      const sites = await listSites(token);
      const site = sites.find(s => s.id === siteId);
      if (site) siteContext = `Website: ${site.displayName}`;
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-alt-text: POST /api/webflow/bulk-generate-alt: programming error'); /* proceed without context */ }
  }

  {
    const bulkIntelContext = await buildIntelPrompt(req.params.workspaceId, ['seoContext'], {
      verbosity: 'compact',
      tokenBudget: 650,
    });
    if (bulkIntelContext) {
      siteContext = siteContext ? `${siteContext}\n${bulkIntelContext}` : bulkIntelContext;
    }
  }

  const assetContextMap = new Map<string, string>();
  if (siteId) {
    try {
      const pages = await getWorkspacePages(req.params.workspaceId, siteId);
      for (const page of pages.slice(0, 15)) {
        try {
          const dom = await getPageDom(page.id, token);
          const plainText = dom.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          for (const asset of assets) {
            if (assetContextMap.has(asset.assetId)) continue;
            if (dom.includes(asset.assetId) || dom.includes(asset.imageUrl)) {
              const idx = plainText.indexOf(asset.assetId) !== -1
                ? plainText.indexOf(asset.assetId)
                : plainText.indexOf(asset.imageUrl.split('/').pop() || '');
              const start = Math.max(0, idx - 100);
              const snippet = plainText.slice(start, start + 200).trim();
              assetContextMap.set(asset.assetId, `Page "${page.title}": ${snippet}`);
            }
          }
        } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-alt-text: programming error'); /* skip page */ }
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-alt-text: programming error'); /* proceed without page context */ }
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data: Record<string, unknown>) => {
    res.write(JSON.stringify(data) + '\n');
  };

  send({ type: 'status', message: 'Processing images...', done: 0, total: assets.length });

  let done = 0;
  for (const asset of assets) {
    // Per-asset atomic check+increment prevents unbounded overshoot when batch size > remaining budget.
    if (!incrementIfAllowed(bulkWs.id, bulkWs.tier || 'free', 'alt_text_generations')) {
      send({ type: 'status', message: `Monthly AI limit reached after ${done}/${assets.length} images`, done, total: assets.length });
      break;
    }
    try {
      let buffer: Buffer;
      try {
        const bytes = await fetchExternalBytes({
          url: asset.imageUrl,
          timeoutMs: 15_000,
          redirect: 'follow',
          urlSafety: 'public-web',
          logContext: { module: 'webflow-alt-text', fetchPath: 'bulk-alt-image' },
        });
        buffer = Buffer.from(bytes);
      } catch (err) {
        done++;
        decrementUsage(bulkWs.id, 'alt_text_generations');
        if (isExternalFetchError(err)) {
          const detail = err.kind === 'http' && err.status ? `Download failed: ${err.status}` : `Download failed: ${err.kind}`;
          send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: detail, done, total: assets.length });
        } else {
          throw err;
        }
        continue;
      }
      const ext = path.extname(asset.imageUrl).split('?')[0] || '.jpg';
      const tmpPath = `/tmp/bulk_alt_${Date.now()}${ext}`;
      fs.writeFileSync(tmpPath, buffer);

      const context = assetContextMap.get(asset.assetId) || siteContext || undefined;
      const altText = await generateAltText(tmpPath, context);
      try { fs.unlinkSync(tmpPath); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-alt-text: programming error'); /* ignore */ }

      done++;
      if (altText) {
        const writeResult = await updateAsset(asset.assetId, { altText }, token);
        if (!writeResult.success) {
          log.error({ detail: writeResult.error }, `Bulk alt: generated but write-back failed for ${asset.assetId}:`);
          decrementUsage(bulkWs.id, 'alt_text_generations');
          send({ type: 'result', assetId: asset.assetId, altText, updated: false, error: writeResult.error, done, total: assets.length });
        } else {
          send({ type: 'result', assetId: asset.assetId, altText, updated: true, done, total: assets.length });
        }
      } else {
        decrementUsage(bulkWs.id, 'alt_text_generations');
        send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: 'Generation returned null', done, total: assets.length });
      }
    } catch (err) {
      done++;
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ detail: msg }, `Bulk alt error for ${asset.assetId}:`);
      decrementUsage(bulkWs.id, 'alt_text_generations');
      send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: msg, done, total: assets.length });
    }
  }

  send({ type: 'done', done, total: assets.length });
  res.end();
});

// --- Image Compression ---
router.post('/api/webflow/:workspaceId/compress/:assetId', requireWorkspaceAccess('workspaceId'), requireWorkspaceSiteAccess({
  workspace: { source: 'params', name: 'workspaceId' },
  site: { source: 'body', name: 'siteId' },
}), async (req, res) => {
  const { imageUrl, siteId, altText, fileName, cmsUsages } = req.body as {
    imageUrl: string;
    siteId: string;
    altText?: string;
    fileName?: string;
    cmsUsages?: CmsImageUsage[];
  };
  if (!imageUrl || !siteId) return res.status(400).json({ error: 'imageUrl and siteId required' });
  const compressToken = getTokenForSite(siteId) || undefined;

  try {
    const originalBytes = await fetchExternalBytes({
      url: imageUrl,
      timeoutMs: 20_000,
      redirect: 'follow',
      urlSafety: 'public-web',
      logContext: { module: 'webflow-alt-text', fetchPath: 'compress-image' },
    });
    const originalBuffer = Buffer.from(originalBytes);
    const compression = await compressImageBuffer(originalBuffer, fileName || imageUrl, {
      outputBaseName: fileName || 'image',
    });
    if ('skipped' in compression) {
      return res.json(compression);
    }

    const result = await replaceCompressedAsset({
      assetId: req.params.assetId,
      imageUrl,
      siteId,
      compression,
      altText,
      cmsUsages,
      token: compressToken,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result);
  } catch (e) {
    log.error({ err: e }, 'Compress error');
    res.status(500).json({ error: 'Compression failed' });
  }
});

export default router;
