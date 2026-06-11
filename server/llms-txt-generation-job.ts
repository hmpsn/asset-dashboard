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
import { generateLlmsTxt, storeResult } from './llms-txt-generator.js';

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

    // Persist the result so GET routes can serve it without re-crawling.
    storeResult(workspaceId, result);

    // I-2: useJobProgress already invalidates the llmsTxtResult + llmsTxtFreshness
    // React Query keys when the job reaches 'done', so no WS broadcast is needed.

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
