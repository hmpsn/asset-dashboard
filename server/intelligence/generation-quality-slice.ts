import type { GenerationQualitySlice } from '../../shared/types/intelligence.js';
import { getLatestGenerationQuality } from '../generation-quality-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('workspace-intelligence/generation-quality');

/**
 * Latest keyword-strategy generation-quality telemetry for a workspace.
 *
 * This is intentionally typed-only for now. Prompt consumers can opt in later
 * once there is a product-approved compact summary contract.
 */
export async function assembleGenerationQuality(workspaceId: string): Promise<GenerationQualitySlice> {
  try {
    return {
      latest: getLatestGenerationQuality(workspaceId),
    };
  } catch (err) {
    log.warn({ err, workspaceId }, 'assembleGenerationQuality: failed, degrading to empty slice');
    return { latest: null };
  }
}
