import { addActivity } from './activity-log.js';
import { isProgrammingError } from './errors.js';
import { fetchExternalBytes } from './external-fetch.js';
import {
  createJob,
  updateJob,
} from './jobs.js';
import { createLogger } from './logger.js';
import { getTokenForSite } from './workspaces.js';
import {
  compressImageBuffer,
  replaceCompressedAsset,
} from './domains/webflow-assets/image-optimization.js';
import type { CmsImageUsage } from '../shared/types/cms-images.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';

const log = createLogger('webflow-bulk-compress-background-job');

export interface BulkCompressAssetInput {
  assetId: string;
  imageUrl: string;
  altText?: string;
  fileName?: string;
  cmsUsages?: CmsImageUsage[];
}

export interface StartWebflowBulkCompressJobParams {
  workspaceId?: string;
  siteId: string;
  assets: BulkCompressAssetInput[];
}

export interface StartedWebflowBulkCompressJob {
  jobId: string;
}

export function startWebflowBulkCompressJob(
  params: StartWebflowBulkCompressJobParams,
): StartedWebflowBulkCompressJob {
  const { workspaceId, siteId, assets } = params;
  const compressToken = getTokenForSite(siteId) || undefined;
  const job = createJob(BACKGROUND_JOB_TYPES.BULK_COMPRESS, {
    message: `Compressing ${assets.length} assets...`,
    total: assets.length,
    workspaceId,
  });

  void (async () => {
    try {
      updateJob(job.id, { status: 'running', progress: 0 });
      let totalSaved = 0;
      const results: unknown[] = [];

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        try {
          const originalBytes = await fetchExternalBytes({
            url: asset.imageUrl,
            timeoutMs: 20_000,
            redirect: 'follow',
            urlSafety: 'public-web',
            logContext: { module: 'webflow-bulk-compress-background-job', fetchPath: 'compress-image' },
          });
          const originalBuffer = Buffer.from(originalBytes);
          const compression = await compressImageBuffer(originalBuffer, asset.fileName || asset.imageUrl, {
            outputBaseName: asset.fileName || 'image',
          });
          const result = 'skipped' in compression
            ? compression
            : await replaceCompressedAsset({
              assetId: asset.assetId,
              imageUrl: asset.imageUrl,
              siteId,
              compression,
              altText: asset.altText,
              cmsUsages: asset.cmsUsages,
              token: compressToken,
            });
          results.push({ assetId: asset.assetId, ...result });
          if ('savings' in result && typeof result.savings === 'number') totalSaved += result.savings;
        } catch (err) {
          log.debug({ err }, 'webflow bulk-compress individual asset failed — skipping');
          results.push({ assetId: asset.assetId, error: String(err) });
        }

        updateJob(job.id, {
          progress: i + 1,
          message: `Compressed ${i + 1}/${assets.length} (${Math.round(totalSaved / 1024)}KB saved)`,
        });
      }

      updateJob(job.id, {
        status: 'done',
        result: { results, totalSaved },
        progress: assets.length,
        message: `Done — saved ${Math.round(totalSaved / 1024)}KB total`,
      });

      if (workspaceId) {
        addActivity(
          workspaceId,
          'images_optimized',
          `Bulk compression: ${assets.length} images processed, ${Math.round(totalSaved / 1024)}KB saved`,
          undefined,
          { processed: assets.length, totalSavedBytes: totalSaved },
        );
      }
    } catch (err) {
      if (isProgrammingError(err)) { // url-fetch-ok
        log.warn({ err }, 'webflow bulk-compress background job failed with programming error');
      } else {
        log.debug({ err }, 'webflow bulk-compress background job failed — degrading gracefully');
      }
      updateJob(job.id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        message: 'Bulk compress failed',
      });
    }
  })();

  return { jobId: job.id };
}
