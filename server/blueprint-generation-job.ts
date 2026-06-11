/**
 * Blueprint Generation Job
 *
 * Wraps generateBlueprint() in the background job platform.
 * Called via setImmediate from POST /api/page-strategy/:workspaceId/generate.
 */
import { addActivity } from './activity-log.js';
import { isProgrammingError } from './errors.js';
import { updateJob, unregisterAbort } from './jobs.js';
import { createLogger } from './logger.js';
import { broadcastToWorkspace } from './broadcast.js';
import { generateBlueprint } from './blueprint-generator.js';
import { WS_EVENTS } from './ws-events.js';
import type { BlueprintGenerationInput } from '../shared/types/page-strategy.js';

const log = createLogger('blueprint-generation-job');

export interface RunBlueprintGenerationJobOptions {
  jobId: string;
  workspaceId: string;
  input: BlueprintGenerationInput;
}

export async function runBlueprintGenerationJob({
  jobId,
  workspaceId,
  input,
}: RunBlueprintGenerationJobOptions): Promise<void> {
  try {
    updateJob(jobId, {
      status: 'running',
      message: 'Generating blueprint from workspace intelligence...',
    });

    const blueprint = await generateBlueprint(workspaceId, input);

    broadcastToWorkspace(workspaceId, WS_EVENTS.BLUEPRINT_GENERATED, { blueprint });

    updateJob(jobId, {
      status: 'done',
      result: blueprint,
      message: `Blueprint "${blueprint.name}" generated — ${blueprint.entries?.length ?? 0} pages`,
    });

    addActivity(
      workspaceId,
      'blueprint_generated',
      `Generated blueprint "${blueprint.name}" (${blueprint.entries?.length ?? 0} pages)`,
    );
  } catch (err) {
    if (isProgrammingError(err)) {
      log.warn({ err, workspaceId }, 'blueprint-generation-job: programming error');
    } else {
      log.debug({ err, workspaceId }, 'blueprint-generation-job: generation failed');
    }
    updateJob(jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'Blueprint generation failed',
    });
  } finally {
    unregisterAbort(jobId);
  }
}
