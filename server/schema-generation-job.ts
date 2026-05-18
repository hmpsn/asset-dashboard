import { addActivity } from './activity-log.js';
import { isProgrammingError } from './errors.js';
import { updateJob, unregisterAbort, isJobCancelled } from './jobs.js';
import { createLogger } from './logger.js';
import { broadcastToWorkspace } from './broadcast.js';
import { prepareBulkSchemaGenerationContext } from './schema-generation-context.js';
import { saveSchemaSnapshot } from './schema-store.js';
import { generateSchemaSuggestions } from './schema-suggester.js';
import { WS_EVENTS } from './ws-events.js';

const log = createLogger('schema-generation-job');

interface RunSchemaGenerationJobOptions {
  jobId: string;
  siteId: string;
  token: string;
  workspaceId: string;
}

export async function runSchemaGenerationJob({
  jobId,
  siteId,
  token,
  workspaceId,
}: RunSchemaGenerationJobOptions): Promise<void> {
  try {
    updateJob(jobId, { status: 'running', message: 'Scanning pages and generating unified schemas...' });
    const { ctx } = await prepareBulkSchemaGenerationContext(siteId);
    // Debounced incremental save — persist partial results every 10s
    let lastSaveTime = 0;
    const SAVE_INTERVAL = 10_000;
    const result = await generateSchemaSuggestions(siteId, token, ctx, (partial, _done, message) => {
      updateJob(jobId, { status: 'running', result: partial, message, progress: partial.length });
      const now = Date.now();
      if (partial.length > 0 && now - lastSaveTime >= SAVE_INTERVAL) {
        lastSaveTime = now;
        saveSchemaSnapshot(siteId, workspaceId, partial);
      }
    }, () => isJobCancelled(jobId));
    // Final save — always write the complete result
    if (result.length > 0) {
      saveSchemaSnapshot(siteId, workspaceId, result);
      if (workspaceId) {
        broadcastToWorkspace(workspaceId, WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED, {
          siteId,
          action: 'generated',
          pageCount: result.length,
        });
      }
    }
    if (isJobCancelled(jobId)) {
      updateJob(jobId, { status: 'cancelled', result, message: `Cancelled — ${result.length} pages completed before stop` });
    } else {
      updateJob(jobId, {
        status: 'done',
        result,
        message: `Done — ${result.length} page schemas generated`,
        progress: result.length,
        total: result.length,
      });
    }
    // Log to activity feed
    if (workspaceId && result.length > 0) {
      addActivity(
        workspaceId,
        'schema_generated',
        `Schema generated for ${result.length} pages`,
        isJobCancelled(jobId) ? 'Partially completed (cancelled)' : 'All pages processed',
      );
    }
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'schema-generation-job: job failed with programming error'); // url-fetch-ok
    else log.debug({ err }, 'schema-generation-job: job failed — degrading gracefully');
    if (!isJobCancelled(jobId)) {
      updateJob(jobId, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Schema generation failed' });
    }
  } finally {
    unregisterAbort(jobId);
  }
}
