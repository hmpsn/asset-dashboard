import fs from 'fs';
import path from 'path';

import { addActivity } from './activity-log.js';
import { generateAltText } from './alttext.js';
import { isProgrammingError } from './errors.js';
import {
  createJob,
  updateJob,
} from './jobs.js';
import { createLogger } from './logger.js';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { getTokenForSite, getWorkspace, getWorkspaceBySiteId } from './workspaces.js';
import { updateAsset } from './webflow.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';

const log = createLogger('webflow-bulk-alt-background-job');

export interface BulkAltAssetInput {
  assetId: string;
  imageUrl: string;
}

export interface StartWebflowBulkAltJobParams {
  workspaceId?: string;
  siteId?: string;
  assets: BulkAltAssetInput[];
}

export interface BulkAltJobResult {
  assetId: string;
  altText?: string;
  updated: boolean;
  error?: string;
}

export interface StartedWebflowBulkAltJob {
  jobId: string;
}

async function buildJobAltContext(workspaceId?: string, siteId?: string): Promise<string> {
  const workspace = workspaceId
    ? getWorkspace(workspaceId)
    : siteId
      ? getWorkspaceBySiteId(siteId)
      : undefined;

  if (!workspace) return '';

  const resolvedWorkspaceId = workspaceId || workspace.id;
  const intelligence = await buildWorkspaceIntelligence(resolvedWorkspaceId, { slices: ['seoContext'] });
  const brandVoiceBlock = intelligence.seoContext?.effectiveBrandVoiceBlock ?? '';
  const parts: string[] = [];

  if (workspace.keywordStrategy?.siteKeywords?.length) {
    parts.push(`Site keywords: ${workspace.keywordStrategy.siteKeywords.slice(0, 5).join(', ')}`);
  }

  let context = parts.length > 0 ? parts.join('. ') : '';
  if (brandVoiceBlock) {
    context = context ? `${context}${brandVoiceBlock}` : brandVoiceBlock;
  }
  return context;
}

export function startWebflowBulkAltJob(
  params: StartWebflowBulkAltJobParams,
): StartedWebflowBulkAltJob {
  const { workspaceId, siteId, assets } = params;
  const job = createJob(BACKGROUND_JOB_TYPES.BULK_ALT, {
    message: `Generating alt text for ${assets.length} images...`,
    total: assets.length,
    workspaceId,
  });

  void (async () => {
    try {
      updateJob(job.id, { status: 'running', progress: 0 });

      const token = siteId ? (getTokenForSite(siteId) || undefined) : undefined;
      const jobAltContext = await buildJobAltContext(workspaceId, siteId);
      const results: BulkAltJobResult[] = [];

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        try {
          const imageResponse = await fetch(asset.imageUrl);
          if (!imageResponse.ok) {
            results.push({ assetId: asset.assetId, updated: false, error: `Download failed: ${imageResponse.status}` });
            continue;
          }

          const buffer = Buffer.from(await imageResponse.arrayBuffer());
          const imageExtension = path.extname(asset.imageUrl).split('?')[0] || '.jpg';
          const tmpPath = `/tmp/bulk_alt_${Date.now()}${imageExtension}`;
          fs.writeFileSync(tmpPath, buffer);

          const altTextResult = await generateAltText(tmpPath, jobAltContext || undefined);
          try {
            fs.unlinkSync(tmpPath);
          } catch (err) {
            if (isProgrammingError(err)) log.warn({ err }, 'webflow bulk-alt background job tmp cleanup failed');
          }

          if (altTextResult) {
            await updateAsset(asset.assetId, { altText: altTextResult }, token);
            results.push({ assetId: asset.assetId, altText: altTextResult, updated: true });
          } else {
            results.push({ assetId: asset.assetId, updated: false, error: 'Generation returned null' });
          }
        } catch (err) {
          log.debug({ err }, 'webflow bulk-alt individual asset failed — skipping');
          results.push({ assetId: asset.assetId, updated: false, error: String(err) });
        }

        updateJob(job.id, {
          progress: i + 1,
          message: `Generated ${i + 1}/${assets.length} alt texts`,
        });
      }

      const updatedCount = results.filter((result) => result.updated).length;
      updateJob(job.id, {
        status: 'done',
        result: results,
        progress: assets.length,
        message: `Done — ${updatedCount}/${assets.length} updated`,
      });

      if (workspaceId) {
        addActivity(
          workspaceId,
          'images_optimized',
          `Bulk alt text: ${updatedCount} images updated`,
          undefined,
          { updated: updatedCount, total: assets.length },
        );
      }
    } catch (err) {
      if (isProgrammingError(err)) { // url-fetch-ok
        log.warn({ err }, 'webflow bulk-alt background job failed with programming error');
      } else {
        log.debug({ err }, 'webflow bulk-alt background job failed — degrading gracefully');
      }
      updateJob(job.id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        message: 'Bulk alt text failed',
      });
    }
  })();

  return { jobId: job.id };
}
