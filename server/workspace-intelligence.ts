// server/workspace-intelligence.ts
// Public facade for workspace intelligence assembly, formatting, and cache management.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3, §12, §13

import { createHash } from 'node:crypto';
import { createLogger } from './logger.js';
import { singleFlight } from './intelligence-cache.js';
import type {
  WorkspaceIntelligence,
  IntelligenceOptions,
  IntelligenceSlice,
  PromptFormatOptions,
} from '../shared/types/intelligence.js';
import { INTELLIGENCE_SLICES } from '../shared/types/intelligence.js';
import {
  canAssembleIntelligenceSlice,
  type IntelligenceSliceMetadataEntry,
  INTELLIGENCE_SLICE_METADATA_REGISTRY,
} from './intelligence/slice-metadata-registry.js';
import { INTELLIGENCE_CACHE_TTL, intelligenceCache } from './intelligence/cache-state.js';
import { formatForPrompt } from './intelligence/formatters.js';
export {
  formatForPrompt,
  formatKnowledgeBaseForPrompt,
  formatKeywordsForPrompt,
  formatPageMapForPrompt,
} from './intelligence/formatters.js';
export { formatPersonasForPrompt } from './intelligence/persona-format.js';
export { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';

const log = createLogger('workspace-intelligence');

export const ALL_INTELLIGENCE_SLICES: readonly IntelligenceSlice[] = INTELLIGENCE_SLICES;

export async function buildWorkspaceIntelligence(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<WorkspaceIntelligence> {
  const cacheKey = buildCacheKey(workspaceId, opts);

  const cached = intelligenceCache.get(cacheKey);
  if (cached && !cached.stale) {
    log.debug({ workspaceId, cache_hit: true, stale: false }, 'Intelligence cache hit');
    return cached.data;
  }
  if (cached?.stale) {
    log.debug({ workspaceId, cache_hit: true, stale: true }, 'Intelligence cache hit (stale)');
  }

  return singleFlight(cacheKey, async () => {
    const start = Date.now();
    const requestedSlices = opts?.slices ?? ALL_INTELLIGENCE_SLICES;

    const result: WorkspaceIntelligence = {
      version: 1,
      workspaceId,
      assembledAt: new Date().toISOString(),
    };

    const assembledSlices = await Promise.all(requestedSlices.map(async (slice) => {
      try {
        return await assembleSlice(workspaceId, slice, opts);
      } catch (err) {
        log.warn({ workspaceId, slice, err }, 'Intelligence slice assembly failed — skipping');
        return undefined;
      }
    }));

    for (const assembled of assembledSlices) {
      if (assembled) Object.assign(result, assembled);
    }

    intelligenceCache.set(cacheKey, result, INTELLIGENCE_CACHE_TTL);

    log.info({
      workspaceId,
      assembly_ms: Date.now() - start,
      slices_requested: requestedSlices,
      slices_returned: Object.keys(result).filter(k => !['version', 'workspaceId', 'assembledAt'].includes(k)),
    }, 'Intelligence assembled');

    return result;
  });
}

async function assembleSlice(
  workspaceId: string,
  slice: IntelligenceSlice,
  opts?: IntelligenceOptions,
): Promise<Partial<WorkspaceIntelligence> | undefined> {
  const entry: IntelligenceSliceMetadataEntry = INTELLIGENCE_SLICE_METADATA_REGISTRY[slice];
  if (!canAssembleIntelligenceSlice(entry, opts)) return undefined;

  return entry.assemble(workspaceId, opts);
}

export async function buildIntelPrompt(
  workspaceId: string,
  slices: readonly IntelligenceSlice[],
  opts?: Omit<IntelligenceOptions, 'slices'> & Pick<PromptFormatOptions, 'verbosity' | 'tokenBudget' | 'learningsDomain'>,
): Promise<string> {
  const intel = await buildWorkspaceIntelligence(workspaceId, { ...opts, slices });
  return formatForPrompt(intel, { verbosity: opts?.verbosity, sections: slices, tokenBudget: opts?.tokenBudget, learningsDomain: opts?.learningsDomain });
}

function tokenFingerprint(token: string | null | undefined): string {
  if (!token) return '';
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function buildCacheKey(workspaceId: string, opts?: IntelligenceOptions): string {
  const slices = [...(opts?.slices ?? ALL_INTELLIGENCE_SLICES)].sort().join(',');
  const page = opts?.pagePath ?? '';
  const domain = opts?.learningsDomain ?? 'all';
  const site = opts?.siteId ?? '';
  const baseUrl = opts?.siteBaseUrl ?? '';
  const token = tokenFingerprint(opts?.webflowToken);
  const backlinks = opts?.enrichWithBacklinks ? ':bl' : '';
  // resolveEntityReferences flips the entityResolution slice between cached labels-only
  // mode and the Wikidata-enriched mode. Without :er in the key, an unenriched cache
  // entry written by a non-schema caller would silently defeat schema enrichment for 5min.
  const entityRes = opts?.resolveEntityReferences ? ':er' : '';
  return `intelligence:${workspaceId}:${slices}:${page}:${domain}:site=${encodeURIComponent(site)}:base=${encodeURIComponent(baseUrl)}:wf=${token}${backlinks}${entityRes}`;
}

/** Cache stats for health endpoint (§18) */
export function getIntelligenceCacheStats() {
  return intelligenceCache.stats();
}

export function getWorkspaceHealthScore(workspaceId: string): number | null {
  const cached = intelligenceCache.peek(buildCacheKey(workspaceId));
  if (cached?.clientSignals?.compositeHealthScore != null) {
    return cached.clientSignals.compositeHealthScore;
  }
  return null;
}
