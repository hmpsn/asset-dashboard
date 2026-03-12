/**
 * AI alt text generation & image compression routes — extracted from webflow.ts
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { generateAltText } from '../alttext.js';
import { buildSeoContext } from '../seo-context.js';
import {
  listSites,
  updateAsset,
  deleteAsset,
  listPages,
  getPageDom,
  uploadAsset,
} from '../webflow.js';
import {
  listWorkspaces,
  getWorkspace,
  getTokenForSite,
} from '../workspaces.js';

const router = Router();

// --- AI Alt Text Generation for existing assets ---
router.post('/api/webflow/generate-alt/:assetId', async (req, res) => {
  const { imageUrl, siteId, workspaceId: altWsId } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

  try {
    let context = '';
    if (siteId) {
      try {
        const tkn = getTokenForSite(siteId) || undefined;
        const pages = await listPages(siteId, tkn);
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
          } catch { /* skip */ }
        }

        if (contextParts.length > 0) {
          context = contextParts.join('\n');
        } else {
          const sites = await listSites(tkn);
          const site = sites.find(s => s.id === siteId);
          if (site) context = `Website: ${site.displayName}`;
        }
      } catch { /* proceed without context */ }
    }

    const response = await fetch(imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = path.extname(imageUrl).split('?')[0] || '.jpg';
    const tmpPath = `/tmp/alt_gen_${Date.now()}${ext}`;
    fs.writeFileSync(tmpPath, buffer);

    const resolvedWsId = altWsId || (siteId ? listWorkspaces().find(w => w.webflowSiteId === siteId)?.id : undefined);
    if (resolvedWsId) {
      const { businessContext: altBizCtx } = buildSeoContext(resolvedWsId);
      const ws = getWorkspace(resolvedWsId);
      const brandVoice = ws?.brandVoice;
      const kwParts: string[] = [];
      if (altBizCtx) kwParts.push(`Business: ${altBizCtx}`);
      if (brandVoice) kwParts.push(`Brand voice: ${brandVoice}`);
      if (ws?.keywordStrategy?.siteKeywords?.length) {
        kwParts.push(`Site keywords: ${ws.keywordStrategy.siteKeywords.slice(0, 5).join(', ')}`);
      }
      if (kwParts.length > 0) {
        context = context ? `${context}\n${kwParts.join('. ')}` : kwParts.join('. ');
      }
    }

    const altText = await generateAltText(tmpPath, context || undefined);
    fs.unlinkSync(tmpPath);

    if (altText) {
      const altToken = siteId ? (getTokenForSite(siteId) || undefined) : undefined;
      const writeResult = await updateAsset(req.params.assetId, { altText }, altToken);
      if (!writeResult.success) {
        console.error(`Alt text generated but Webflow write-back failed for ${req.params.assetId}:`, writeResult.error);
        res.json({ altText, updated: false, writeError: writeResult.error });
      } else {
        console.log(`Alt text generated and saved for ${req.params.assetId}: "${altText}"`);
        res.json({ altText, updated: true });
      }
    } else {
      console.warn(`Alt text generation returned null for ${req.params.assetId}`);
      res.json({ altText: null, updated: false });
    }
  } catch (e) {
    console.error('Generate alt error:', e);
    res.status(500).json({ error: 'Failed to generate alt text' });
  }
});

// --- Bulk AI Alt Text Generation (fetches context once) ---
router.post('/api/webflow/bulk-generate-alt', async (req, res) => {
  const { assets, siteId, workspaceId: bulkAltWsId } = req.body as {
    assets: Array<{ assetId: string; imageUrl: string }>;
    siteId?: string;
    workspaceId?: string;
  };
  if (!assets?.length) return res.status(400).json({ error: 'assets required' });

  const token = siteId ? (getTokenForSite(siteId) || undefined) : undefined;

  let siteContext = '';
  if (siteId) {
    try {
      const sites = await listSites(token);
      const site = sites.find(s => s.id === siteId);
      if (site) siteContext = `Website: ${site.displayName}`;
    } catch { /* proceed without context */ }
  }

  const bulkWsId = bulkAltWsId || (siteId ? listWorkspaces().find(w => w.webflowSiteId === siteId)?.id : undefined);
  if (bulkWsId) {
    const { businessContext: bulkBizCtx } = buildSeoContext(bulkWsId);
    const bulkWs = getWorkspace(bulkWsId);
    const kwParts: string[] = [];
    if (bulkBizCtx) kwParts.push(`Business: ${bulkBizCtx}`);
    if (bulkWs?.brandVoice) kwParts.push(`Brand voice: ${bulkWs.brandVoice}`);
    if (bulkWs?.keywordStrategy?.siteKeywords?.length) {
      kwParts.push(`Site keywords: ${bulkWs.keywordStrategy.siteKeywords.slice(0, 5).join(', ')}`);
    }
    if (kwParts.length > 0) {
      siteContext = siteContext ? `${siteContext}. ${kwParts.join('. ')}` : kwParts.join('. ');
    }
  }

  const assetContextMap = new Map<string, string>();
  if (siteId) {
    try {
      const pages = await listPages(siteId, token);
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
        } catch { /* skip page */ }
      }
    } catch { /* proceed without page context */ }
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
    try {
      const response = await fetch(asset.imageUrl);
      if (!response.ok) {
        done++;
        send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: `Download failed: ${response.status}`, done, total: assets.length });
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = path.extname(asset.imageUrl).split('?')[0] || '.jpg';
      const tmpPath = `/tmp/bulk_alt_${Date.now()}${ext}`;
      fs.writeFileSync(tmpPath, buffer);

      const context = assetContextMap.get(asset.assetId) || siteContext || undefined;
      const altText = await generateAltText(tmpPath, context);
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }

      done++;
      if (altText) {
        const writeResult = await updateAsset(asset.assetId, { altText }, token);
        if (!writeResult.success) {
          console.error(`Bulk alt: generated but write-back failed for ${asset.assetId}:`, writeResult.error);
          send({ type: 'result', assetId: asset.assetId, altText, updated: false, error: writeResult.error, done, total: assets.length });
        } else {
          send({ type: 'result', assetId: asset.assetId, altText, updated: true, done, total: assets.length });
        }
      } else {
        send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: 'Generation returned null', done, total: assets.length });
      }
    } catch (err) {
      done++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Bulk alt error for ${asset.assetId}:`, msg);
      send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: msg, done, total: assets.length });
    }
  }

  send({ type: 'done', done, total: assets.length });
  res.end();
});

// --- Image Compression ---
router.post('/api/webflow/compress/:assetId', async (req, res) => {
  const { imageUrl, siteId, altText, fileName } = req.body;
  if (!imageUrl || !siteId) return res.status(400).json({ error: 'imageUrl and siteId required' });
  const compressToken = getTokenForSite(siteId) || undefined;

  try {
    const sharp = (await import('sharp')).default;

    const response = await fetch(imageUrl);
    const originalBuffer = Buffer.from(await response.arrayBuffer());
    const originalSize = originalBuffer.length;

    const ext = (fileName || imageUrl).split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    let compressed: Buffer;
    let newFileName: string;
    const baseName = (fileName || 'image').replace(/\.[^.]+$/, '');

    if (ext === 'svg') {
      const svgo = await import('svgo');
      let compressedSvg: Buffer;
      try {
        const svgString = originalBuffer.toString('utf-8');
        const result = svgo.optimize(svgString, {
          multipass: true,
          plugins: ['preset-default'],
        } as Parameters<typeof svgo.optimize>[1]);
        compressedSvg = Buffer.from(result.data, 'utf-8');
      } catch (svgoErr) {
        console.error('SVGO error:', svgoErr);
        return res.json({ skipped: true, reason: 'SVGO optimization failed: ' + (svgoErr instanceof Error ? svgoErr.message : String(svgoErr)) });
      }

      const svgNewSize = compressedSvg.length;
      const svgSavings = originalSize - svgNewSize;
      const svgSavingsPercent = Math.round((svgSavings / originalSize) * 100);

      if (svgSavingsPercent < 3) {
        return res.json({ skipped: true, reason: `SVG already optimized (only ${svgSavingsPercent}% savings)`, originalSize, newSize: svgNewSize });
      }

      compressed = compressedSvg;
      newFileName = `${baseName}.svg`;
    } else if (ext === 'jpg' || ext === 'jpeg') {
      compressed = await sharp(originalBuffer)
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      newFileName = `${baseName}.jpg`;
    } else if (ext === 'png') {
      const webpBuffer = await sharp(originalBuffer)
        .webp({ quality: 80 })
        .toBuffer();
      const pngBuffer = await sharp(originalBuffer)
        .png({ compressionLevel: 9, palette: true })
        .toBuffer();
      if (webpBuffer.length < pngBuffer.length) {
        compressed = webpBuffer;
        newFileName = `${baseName}.webp`;
      } else {
        compressed = pngBuffer;
        newFileName = `${baseName}.png`;
      }
    } else {
      compressed = await sharp(originalBuffer)
        .webp({ quality: 80 })
        .toBuffer();
      newFileName = `${baseName}.webp`;
    }

    const newSize = compressed.length;
    const savings = originalSize - newSize;
    const savingsPercent = Math.round((savings / originalSize) * 100);

    if (ext !== 'svg' && savingsPercent < 5) {
      return res.json({
        skipped: true,
        reason: `Already optimized (only ${savingsPercent}% savings)`,
        originalSize,
        newSize,
      });
    }

    const tmpPath = `/tmp/compressed_${Date.now()}_${newFileName}`;
    fs.writeFileSync(tmpPath, compressed);

    const uploadResult = await uploadAsset(siteId, tmpPath, newFileName, altText, compressToken);
    fs.unlinkSync(tmpPath);

    if (!uploadResult.success) {
      return res.status(500).json({ error: uploadResult.error });
    }

    await deleteAsset(req.params.assetId, compressToken);

    res.json({
      success: true,
      newAssetId: uploadResult.assetId,
      newHostedUrl: uploadResult.hostedUrl,
      originalSize,
      newSize,
      savings,
      savingsPercent,
      newFileName,
    });
  } catch (e) {
    console.error('Compress error:', e);
    res.status(500).json({ error: 'Compression failed' });
  }
});

export default router;
