import fs from 'fs';

import { addActivity } from './activity-log.js';
import { isProgrammingError } from './errors.js';
import {
  createJob,
  updateJob,
} from './jobs.js';
import { createLogger } from './logger.js';
import {
  deleteAsset,
  uploadAsset,
} from './webflow.js';
import { getTokenForSite } from './workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import { compressImageBuffer } from './domains/webflow-assets/image-optimization.js';

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

      const tmpPath = `/tmp/compressed_${Date.now()}_${compression.newFileName}`;
      fs.writeFileSync(tmpPath, compression.compressed);
      const uploadResult = await uploadAsset(siteId, tmpPath, compression.newFileName, altText, compressToken);
      try {
        fs.unlinkSync(tmpPath);
      } catch (err) {
        if (isProgrammingError(err)) log.warn({ err }, 'webflow image compress job temp file cleanup failed with programming error');
      }

      if (!uploadResult.success) {
        updateJob(job.id, { status: 'error', error: uploadResult.error, message: 'Upload failed' });
        return;
      }

      await deleteAsset(assetId, compressToken);
      updateJob(job.id, {
        status: 'done',
        result: {
          success: true,
          newAssetId: uploadResult.assetId,
          originalSize: compression.originalSize,
          newSize: compression.newSize,
          savings: compression.savings,
          savingsPercent: compression.savingsPercent,
          newFileName: compression.newFileName,
        },
        message: `Saved ${Math.round(compression.savings / 1024)}KB (${compression.savingsPercent}%)`,
      });

      if (workspaceId) {
        addActivity(
          workspaceId,
          'images_optimized',
          `Image compressed: ${fileName || 'image'} — saved ${Math.round(compression.savings / 1024)}KB (${compression.savingsPercent}%)`,
          undefined,
          {
            originalSize: compression.originalSize,
            newSize: compression.newSize,
            savings: compression.savings,
            savingsPercent: compression.savingsPercent,
          },
        );
      }
    } catch (err) {
      if (isProgrammingError(err)) {
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
