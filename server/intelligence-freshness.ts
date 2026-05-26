import { invalidateContentPipelineCache } from './workspace-data.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';

export function invalidateContentPipelineIntelligence(workspaceId: string): void {
  try {
    invalidateContentPipelineCache(workspaceId);
  } catch { // catch-ok - older migration/test DBs may not have content_pipeline_cache; intelligence invalidation still has to proceed.
  }
  invalidateIntelligenceCache(workspaceId);
}
