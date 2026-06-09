import { addActivity } from './activity-log.js';
import { isProgrammingError } from './errors.js';
import {
  createJob,
  updateJob,
} from './jobs.js';
import { createLogger } from './logger.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';

const log = createLogger('webflow-bulk-compress-background-job');

export interface BulkCompressAssetInput {
  assetId: string;
  imageUrl: string;
  altText?: string;
  fileName?: string;
  cmsUsages?: unknown[];
}

export interface StartWebflowBulkCompressJobParams {
  workspaceId?: string;
  siteId: string;
  assets: BulkCompressAssetInput[];
  baseUrl: string;
  headers: Record<string, string>;
}

export interface StartedWebflowBulkCompressJob {
  jobId: string;
}

export function startWebflowBulkCompressJob(
  params: StartWebflowBulkCompressJobParams,
): StartedWebflowBulkCompressJob {
  const { workspaceId, siteId, assets, baseUrl, headers } = params;
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
          const compressRes = await fetch(`${baseUrl}/api/webflow/${workspaceId}/compress/${asset.assetId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({
              imageUrl: asset.imageUrl,
              siteId,
              altText: asset.altText,
              fileName: asset.fileName,
              cmsUsages: asset.cmsUsages,
            }),
          });
          const result = await compressRes.json() as Record<string, unknown>;
          results.push({ assetId: asset.assetId, ...result });
          if (typeof result.savings === 'number') totalSaved += result.savings;
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
