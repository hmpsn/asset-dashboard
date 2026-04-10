/**
 * AI alt text generation & image compression routes — extracted from webflow.ts
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { generateAltText } from '../alttext.js';
import { buildWorkspaceIntelligence } from '../workspace-intelligence.js';
import {
  listSites,
  updateAsset,
  deleteAsset,
  getPageDom,
  uploadAsset,
} from '../webflow.js';
import { updateCollectionItem, getCollectionItem, publishCollectionItems } from '../webflow-cms.js';
import type { CmsImageUsage } from '../../shared/types/cms-images.ts';
import {
  listWorkspaces,
  getWorkspace,
  getTokenForSite,
} from '../workspaces.js';
import { getWorkspacePages } from '../workspace-data.js';
import { createLogger } from '../logger.js';

const log = createLogger('webflow-alt-text');

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
        const altWs = listWorkspaces().find(w => w.webflowSiteId === siteId);
        const pages = altWs ? await getWorkspacePages(altWs.id, siteId) : [];
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
      const altIntel = await buildWorkspaceIntelligence(resolvedWsId, { slices: ['seoContext'] });
      const altBizCtx = altIntel.seoContext?.businessContext ?? '';
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
        log.error({ detail: writeResult.error }, `Alt text generated but Webflow write-back failed for ${req.params.assetId}:`);
        res.json({ altText, updated: false, writeError: writeResult.error });
      } else {
        log.info(`Alt text generated and saved for ${req.params.assetId}: "${altText}"`);
        res.json({ altText, updated: true });
      }
    } else {
      log.warn(`Alt text generation returned null for ${req.params.assetId}`);
      res.json({ altText: null, updated: false });
    }
  } catch (e) {
    log.error({ err: e }, 'Generate alt error');
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
    const bulkIntel = await buildWorkspaceIntelligence(bulkWsId, { slices: ['seoContext'] });
    const bulkBizCtx = bulkIntel.seoContext?.businessContext ?? '';
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
      const pages = bulkWsId ? await getWorkspacePages(bulkWsId, siteId) : [];
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
          log.error({ detail: writeResult.error }, `Bulk alt: generated but write-back failed for ${asset.assetId}:`);
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
      log.error({ detail: msg }, `Bulk alt error for ${asset.assetId}:`);
      send({ type: 'result', assetId: asset.assetId, altText: null, updated: false, error: msg, done, total: assets.length });
    }
  }

  send({ type: 'done', done, total: assets.length });
  res.end();
});

// --- CMS Reference Repair Helper ---
// Called after a new compressed asset is uploaded to update CMS items that
// referenced the old asset ID. Runs before deleting the old asset so that
// if updates fail, the old asset still exists as a fallback.
async function repairCmsReferences(
  cmsUsages: CmsImageUsage[],
  oldAssetId: string,
  newAssetId: string,
  newHostedUrl: string,
  oldHostedUrl: string,
  token?: string,
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  // Group usages by collection+item to batch field updates per item
  const itemMap = new Map<string, { collectionId: string; fields: Array<{ fieldSlug: string; fieldType: string }> }>();
  for (const usage of cmsUsages) {
    const key = `${usage.collectionId}:${usage.itemId}`;
    if (!itemMap.has(key)) itemMap.set(key, { collectionId: usage.collectionId, fields: [] });
    itemMap.get(key)!.fields.push({ fieldSlug: usage.fieldSlug, fieldType: usage.fieldType });
  }

  // Track which collections have updated items (for optional publish)
  const updatedByCollection = new Map<string, string[]>();

  for (const [key, { collectionId, fields }] of itemMap.entries()) {
    const itemId = key.split(':')[1];

    // Fetch current item to handle MultiImage array updates and RichText replacements
    let currentItem: Record<string, unknown> | null = null;
    const multiImageFields = fields.filter(f => f.fieldType === 'MultiImage');
    const richTextFields = fields.filter(f => f.fieldType === 'RichText');
    if (multiImageFields.length > 0 || richTextFields.length > 0) {
      try {
        currentItem = await getCollectionItem(collectionId, itemId, token);
      } catch { /* proceed without current item data */ }
    }

    const fieldData: Record<string, unknown> = {};

    for (const { fieldSlug, fieldType } of fields) {
      if (fieldType === 'Image') {
        fieldData[fieldSlug] = { fileId: newAssetId, url: newHostedUrl };
      } else if (fieldType === 'MultiImage' && currentItem) {
        const fd = (currentItem.fieldData || currentItem) as Record<string, unknown>;
        const currentArray = fd[fieldSlug];
        if (Array.isArray(currentArray)) {
          fieldData[fieldSlug] = currentArray.map((img: unknown) => {
            const imgObj = img as Record<string, unknown>;
            if (imgObj.fileId === oldAssetId) {
              return { fileId: newAssetId, url: newHostedUrl };
            }
            return img;
          });
        } else {
          fieldData[fieldSlug] = [{ fileId: newAssetId, url: newHostedUrl }];
        }
      } else if (fieldType === 'RichText' && currentItem && oldHostedUrl) {
        const fd = (currentItem.fieldData || currentItem) as Record<string, unknown>;
        const htmlString = fd[fieldSlug];
        if (typeof htmlString === 'string' && htmlString.includes(oldHostedUrl)) {
          // Replace all occurrences of the old CDN URL with the new one
          fieldData[fieldSlug] = htmlString.split(oldHostedUrl).join(newHostedUrl);
        }
      }
    }

    if (Object.keys(fieldData).length === 0) continue;

    // Rate-limit CMS PATCH calls
    await new Promise(r => setTimeout(r, 200));

    const result = await updateCollectionItem(collectionId, itemId, fieldData, token);
    if (result.success) {
      succeeded++;
      if (!updatedByCollection.has(collectionId)) updatedByCollection.set(collectionId, []);
      updatedByCollection.get(collectionId)!.push(itemId);
    } else {
      failed++;
      log.warn({ collectionId, itemId, error: result.error }, 'CMS reference repair failed for item');
    }
  }

  // Auto-publish updated items so changes go live
  for (const [collectionId, itemIds] of updatedByCollection.entries()) {
    try {
      await publishCollectionItems(collectionId, itemIds, token);
    } catch { /* publish is best-effort */ }
  }

  return { succeeded, failed };
}

// --- Image Compression ---
router.post('/api/webflow/compress/:assetId', async (req, res) => {
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
        log.error({ err: svgoErr }, 'SVGO error');
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

    // Repair CMS references BEFORE deleting old asset (so old asset stays as fallback if updates fail)
    let cmsUpdates: { succeeded: number; failed: number } | undefined;
    if (cmsUsages?.length && uploadResult.assetId && uploadResult.hostedUrl) {
      cmsUpdates = await repairCmsReferences(
        cmsUsages,
        req.params.assetId,
        uploadResult.assetId,
        uploadResult.hostedUrl,
        imageUrl,
        compressToken,
      );
    }

    // Only delete old asset if CMS repairs either weren't needed or all succeeded.
    // When repairs fail OR were needed but skipped (e.g. missing hostedUrl),
    // the old asset must remain so CMS items aren't broken.
    const cmsRepairsNeeded = !!(cmsUsages?.length);
    const cmsRepairsSkipped = cmsRepairsNeeded && !cmsUpdates;
    const hasFailedCmsRepairs = cmsUpdates && cmsUpdates.failed > 0;
    if (!hasFailedCmsRepairs && !cmsRepairsSkipped) {
      await deleteAsset(req.params.assetId, compressToken);
    } else {
      log.warn({ assetId: req.params.assetId, failed: cmsUpdates?.failed, skipped: cmsRepairsSkipped }, 'Skipping old asset deletion — CMS reference repairs had failures or were skipped');
    }

    res.json({
      success: true,
      newAssetId: uploadResult.assetId,
      newHostedUrl: uploadResult.hostedUrl,
      originalSize,
      newSize,
      savings,
      savingsPercent,
      newFileName,
      oldAssetPreserved: !!(hasFailedCmsRepairs || cmsRepairsSkipped),
      ...(cmsUpdates ? { cmsUpdates } : {}),
    });
  } catch (e) {
    log.error({ err: e }, 'Compress error');
    res.status(500).json({ error: 'Compression failed' });
  }
});

export default router;
