/**
 * LLMs.txt Generation Job
 *
 * Wraps generateLlmsTxt() in the background job platform.
 * Called via setImmediate from POST /api/llms-txt/:workspaceId/generate.
 *
 * The 3 existing GET routes (/api/llms-txt/:wsId, /download, /download-full) now
 * serve the cached/stored result via getLastGenerated() + cached summaries without
 * triggering a fresh generation. Use this POST endpoint to kick off a new run.
 */
import { addActivity } from './activity-log.js';
import { isProgrammingError } from './errors.js';
import { updateJob, unregisterAbort } from './jobs.js';
import { createLogger } from './logger.js';
import { broadcastToWorkspace } from './broadcast.js';
import { generateLlmsTxt } from './llms-txt-generator.js';
import { WS_EVENTS } from './ws-events.js';

const log = createLogger('llms-txt-generation-job');

export interface RunLlmsTxtGenerationJobOptions {
  jobId: string;
  workspaceId: string;
}

export async function runLlmsTxtGenerationJob({
  jobId,
  workspaceId,
}: RunLlmsTxtGenerationJobOptions): Promise<void> {
  try {
    updateJob(jobId, {
      status: 'running',
      message: 'Generating LLMs.txt with AI page summaries...',
    });

    const result = await generateLlmsTxt(workspaceId);

    broadcastToWorkspace(workspaceId, WS_EVENTS.LLMS_TXT_GENERATED, {
      pageCount: result.pageCount,
      generatedAt: result.generatedAt,
    });

    updateJob(jobId, {
      status: 'done',
      result,
      message: `LLMs.txt generated — ${result.pageCount} pages`,
    });

    addActivity(
      workspaceId,
      'llms_txt_generated',
      `Generated LLMs.txt (${result.pageCount} pages)`,
    );
  } catch (err) {
    if (isProgrammingError(err)) {
      log.warn({ err, workspaceId }, 'llms-txt-generation-job: programming error');
    } else {
      log.debug({ err, workspaceId }, 'llms-txt-generation-job: generation failed');
    }
    updateJob(jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'LLMs.txt generation failed',
    });
  } finally {
    unregisterAbort(jobId);
  }
}
