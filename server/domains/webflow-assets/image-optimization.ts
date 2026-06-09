import type { default as SharpConstructor } from 'sharp';
import type * as SvgoMod from 'svgo';
import type { CmsImageUsage } from '../../../shared/types/cms-images.js';
import { isProgrammingError } from '../../errors.js';
import { createLogger } from '../../logger.js';
import {
  getCollectionItem,
  publishCollectionItems,
  updateCollectionItem,
} from '../../webflow-cms.js';

const log = createLogger('webflow-image-optimization');

export interface CompressionResult {
  compressed: Buffer;
  newFileName: string;
  originalSize: number;
  newSize: number;
  savings: number;
  savingsPercent: number;
}

export interface CompressionSkipResult {
  skipped: true;
  reason: string;
  originalSize: number;
  newSize: number;
}

interface CompressImageBufferOptions {
  outputBaseName?: string;
  rasterThresholdPercent?: number;
  svgThresholdPercent?: number;
  rasterSkipReasonLabel?: string;
  svgSkipReasonLabel?: string;
  svgFailureMode?: 'skip' | 'throw';
}

export async function compressImageBuffer(
  originalBuffer: Buffer,
  sourceName: string,
  options: CompressImageBufferOptions = {},
): Promise<CompressionResult | CompressionSkipResult> {
  const sharp: typeof SharpConstructor = (await import('sharp')).default; // dynamic-import-ok

  const originalSize = originalBuffer.length;
  const ext = sourceName.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
  const baseName = (options.outputBaseName || sourceName).replace(/\.[^.]+$/, '');
  const rasterThresholdPercent = options.rasterThresholdPercent ?? 5;
  const svgThresholdPercent = options.svgThresholdPercent ?? 3;
  const rasterSkipReasonLabel = options.rasterSkipReasonLabel ?? 'Already optimized';
  const svgSkipReasonLabel = options.svgSkipReasonLabel ?? 'SVG already optimized';
  const svgFailureMode = options.svgFailureMode ?? 'skip';

  let compressed: Buffer;
  let newFileName: string;

  if (ext === 'svg') {
    const svgo: typeof SvgoMod = await import('svgo'); // dynamic-import-ok
    try {
      const svgString = originalBuffer.toString('utf-8');
      const result = svgo.optimize(svgString, {
        multipass: true,
        plugins: ['preset-default'],
      } as Parameters<typeof svgo.optimize>[1]);
      compressed = Buffer.from(result.data, 'utf-8');
      newFileName = `${baseName}.svg`;
    } catch (err) {
      log.error({ err }, 'SVGO error');
      if (svgFailureMode === 'throw') {
        throw err;
      }
      return {
        skipped: true,
        reason: `SVGO optimization failed: ${err instanceof Error ? err.message : String(err)}`,
        originalSize,
        newSize: originalSize,
      };
    }
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
  const threshold = ext === 'svg' ? svgThresholdPercent : rasterThresholdPercent;
  const typeLabel = ext === 'svg' ? svgSkipReasonLabel : rasterSkipReasonLabel;

  if (savingsPercent < threshold) {
    return {
      skipped: true,
      reason: `${typeLabel} (only ${savingsPercent}% savings)`,
      originalSize,
      newSize,
    };
  }

  return {
    compressed,
    newFileName,
    originalSize,
    newSize,
    savings,
    savingsPercent,
  };
}

export async function repairCmsReferences(
  cmsUsages: CmsImageUsage[],
  oldAssetId: string,
  newAssetId: string,
  newHostedUrl: string,
  oldHostedUrl: string,
  token?: string,
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  const itemMap = new Map<string, {
    collectionId: string;
    fields: Array<{ fieldSlug: string; fieldType: string }>;
  }>();

  for (const usage of cmsUsages) {
    const key = `${usage.collectionId}:${usage.itemId}`;
    if (!itemMap.has(key)) {
      itemMap.set(key, { collectionId: usage.collectionId, fields: [] });
    }
    itemMap.get(key)!.fields.push({ fieldSlug: usage.fieldSlug, fieldType: usage.fieldType });
  }

  const updatedByCollection = new Map<string, string[]>();

  for (const [key, { collectionId, fields }] of itemMap.entries()) {
    const itemId = key.split(':')[1];

    let currentItem: Record<string, unknown> | null = null;
    const multiImageFields = fields.filter((field) => field.fieldType === 'MultiImage');
    const richTextFields = fields.filter((field) => field.fieldType === 'RichText');
    if (multiImageFields.length > 0 || richTextFields.length > 0) {
      try {
        currentItem = await getCollectionItem(collectionId, itemId, token);
      } catch (err) {
        if (isProgrammingError(err)) {
          log.warn({ err }, 'webflow-image-optimization: getCollectionItem programming error');
        }
      }
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
          fieldData[fieldSlug] = htmlString.split(oldHostedUrl).join(newHostedUrl);
        }
      }
    }

    if (Object.keys(fieldData).length === 0) continue;

    await new Promise((resolve) => setTimeout(resolve, 200));

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

  for (const [collectionId, itemIds] of updatedByCollection.entries()) {
    try {
      await publishCollectionItems(collectionId, itemIds, token);
    } catch (err) {
      if (isProgrammingError(err)) {
        log.warn({ err }, 'webflow-image-optimization: publishCollectionItems programming error');
      }
    }
  }

  return { succeeded, failed };
}
