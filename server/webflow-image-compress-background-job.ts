import { addActivity } from './activity-log.js';
import { isProgrammingError } from './errors.js';
import {
  createJob,
  updateJob,
} from './jobs.js';
import { createLogger } from './logger.js';
import {
  getTokenForSite,
} from './workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import {
  compressImageBuffer,
  replaceCompressedAsset,
} from './domains/webflow-assets/image-optimization.js';

const log = createLogger('webflow-image-compress-background-job');

export interface StartWebflowImageCompressJobParams {
  workspaceId?: string;
  assetId: string;
  imageUrl: string;
  siteId: string;
  altText?: string;
  fileName?: string;
}

export interface StartedWebflowImageCompressJob {
  jobId: string;
}

export function startWebflowImageCompressJob(
  params: StartWebflowImageCompressJobParams,
): StartedWebflowImageCompressJob {
  const { workspaceId, assetId, imageUrl, siteId, altText, fileName } = params;
  const compressToken = getTokenForSite(siteId) || undefined;
  const job = createJob(BACKGROUND_JOB_TYPES.COMPRESS, {
    message: `Compressing ${fileName || 'image'}...`,
    workspaceId,
  });

  void (async () => {
    try {
      updateJob(job.id, { status: 'running' });
      const response = await fetch(imageUrl);
      const originalBuffer = Buffer.from(await response.arrayBuffer());
      const compression = await compressImageBuffer(originalBuffer, fileName || imageUrl, {
        outputBaseName: fileName || 'image',
        rasterThresholdPercent: 3,
        svgThresholdPercent: 3,
        rasterSkipReasonLabel: 'Already optimized',
        svgSkipReasonLabel: 'Already optimized',
        svgFailureMode: 'throw',
      });

      if ('skipped' in compression) {
        updateJob(job.id, {
          status: 'done',
          result: { skipped: true, reason: compression.reason },
          message: 'Already optimized',
        });
        return;
      }

      const result = await replaceCompressedAsset({
        assetId,
        imageUrl,
        siteId,
        compression,
        altText,
        token: compressToken,
      });

      if (!result.success) {
        updateJob(job.id, { status: 'error', error: result.error, message: 'Upload failed' });
        return;
      }

      const jobResult = {
        success: true,
        newAssetId: result.newAssetId,
        originalSize: result.originalSize,
        newSize: result.newSize,
        savings: result.savings,
        savingsPercent: result.savingsPercent,
        newFileName: result.newFileName,
      };

      updateJob(job.id, {
        status: 'done',
        result: jobResult,
        message: `Saved ${Math.round(result.savings! / 1024)}KB (${result.savingsPercent}%)`,
      });

      if (workspaceId) {
        addActivity(
          workspaceId,
          'images_optimized',
          `Image compressed: ${fileName || 'image'} — saved ${Math.round(result.savings! / 1024)}KB (${result.savingsPercent}%)`,
          undefined,
          {
            originalSize: result.originalSize,
            newSize: result.newSize,
            savings: result.savings,
            savingsPercent: result.savingsPercent,
          },
        );
      }
    } catch (err) {
      if (isProgrammingError(err)) { // url-fetch-ok
        log.warn({ err }, 'webflow image compress background job failed with programming error');
      } else {
        log.debug({ err }, 'webflow image compress background job failed — degrading gracefully');
      }
      updateJob(job.id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        message: 'Compression failed',
      });
    }
  })();

  return { jobId: job.id };
}
