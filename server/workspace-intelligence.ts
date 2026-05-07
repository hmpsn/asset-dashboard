// server/workspace-intelligence.ts
// Public facade for workspace intelligence assembly, formatting, and cache management.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §3, §12, §13

import { createHash } from 'node:crypto';
import { createLogger } from './logger.js';
import { LRUCache, singleFlight } from './intelligence-cache.js';
import { invalidateSubCachePrefix } from './bridge-infrastructure.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import type {
  WorkspaceIntelligence,
  IntelligenceOptions,
  IntelligenceSlice,
  PromptFormatOptions,
} from '../shared/types/intelligence.js';
import { assemblePageElements } from './intelligence/page-elements-slice.js';
import { assembleSiteInventory } from './intelligence/site-inventory-slice.js';
import { assembleSeoContext } from './intelligence/seo-context-slice.js';
import { assembleInsights } from './intelligence/insights-slice.js';
import { assembleLearnings } from './intelligence/learnings-slice.js';
import { assembleContentPipeline } from './intelligence/content-pipeline-slice.js';
import { assembleSiteHealth } from './intelligence/site-health-slice.js';
import { assembleClientSignals } from './intelligence/client-signals-slice.js';
import { assembleOperational } from './intelligence/operational-slice.js';
import { assemblePageProfile } from './intelligence/page-profile-slice.js';
import { formatForPrompt } from './intelligence/formatters.js';
export {
  formatForPrompt,
  formatKnowledgeBaseForPrompt,
  formatKeywordsForPrompt,
  formatPersonasForPrompt,
  formatPageMapForPrompt,
} from './intelligence/formatters.js';

const log = createLogger('workspace-intelligence');

const intelligenceCache = new LRUCache<WorkspaceIntelligence>(200);
const INTELLIGENCE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const ALL_SLICES: IntelligenceSlice[] = [
  'seoContext', 'insights', 'learnings', 'pageProfile', 'pageElements',
  'siteInventory', 'contentPipeline', 'siteHealth', 'clientSignals', 'operational',
];

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
    const requestedSlices = opts?.slices ?? ALL_SLICES;

    const result: WorkspaceIntelligence = {
      version: 1,
      workspaceId,
      assembledAt: new Date().toISOString(),
    };

    for (const slice of requestedSlices) {
      try {
        await assembleSlice(result, workspaceId, slice, opts);
      } catch (err) {
        log.warn({ workspaceId, slice, err }, 'Intelligence slice assembly failed — skipping');
      }
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
  result: WorkspaceIntelligence,
  workspaceId: string,
  slice: IntelligenceSlice,
  opts?: IntelligenceOptions,
): Promise<void> {
  switch (slice) {
    case 'seoContext':
      result.seoContext = await assembleSeoContext(workspaceId, opts);
      break;
    case 'insights':
      result.insights = await assembleInsights(workspaceId, opts);
      break;
    case 'learnings':
      result.learnings = await assembleLearnings(workspaceId, opts);
      break;
    case 'contentPipeline':
      result.contentPipeline = await assembleContentPipeline(workspaceId);
      break;
    case 'siteHealth':
      try {
        result.siteHealth = await Promise.race([
          assembleSiteHealth(workspaceId, opts),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('siteHealth assembler timed out')), 5000),
          ),
        ]);
      } catch (err) {
        log.warn({ workspaceId, slice, err }, 'siteHealth slice assembly failed — skipping');
      }
      break;
    case 'clientSignals':
      result.clientSignals = await assembleClientSignals(workspaceId, opts);
      break;
    case 'operational':
      result.operational = await assembleOperational(workspaceId, opts);
      break;
    case 'pageProfile':
      if (opts?.pagePath) {
        result.pageProfile = await assemblePageProfile(workspaceId, opts.pagePath, opts);
      }
      break;
    case 'pageElements':
      if (!opts?.pagePath) break;
      result.pageElements = await assemblePageElements(workspaceId, opts.pagePath);
      break;
    case 'siteInventory':
      if (!opts?.siteId || !opts.siteBaseUrl) break;
      result.siteInventory = await assembleSiteInventory(workspaceId, opts.siteId, opts.siteBaseUrl, opts.webflowToken);
      break;
  }
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
  const slices = [...(opts?.slices ?? ALL_SLICES)].sort().join(',');
  const page = opts?.pagePath ?? '';
  const domain = opts?.learningsDomain ?? 'all';
  const site = opts?.siteId ?? '';
  const baseUrl = opts?.siteBaseUrl ?? '';
  const token = tokenFingerprint(opts?.webflowToken);
  const backlinks = opts?.enrichWithBacklinks ? ':bl' : '';
  return `intelligence:${workspaceId}:${slices}:${page}:${domain}:site=${encodeURIComponent(site)}:base=${encodeURIComponent(baseUrl)}:wf=${token}${backlinks}`;
}

/** Invalidate all cached intelligence for a workspace */
export function invalidateIntelligenceCache(workspaceId: string): void {
  const deleted = intelligenceCache.deleteByPrefix(`intelligence:${workspaceId}:`);
  try {
    invalidateSubCachePrefix(workspaceId, '');
  } catch { // catch-ok — sub-cache table may not exist on older DBs; non-critical
  }

  try {
    broadcastToWorkspace(workspaceId, WS_EVENTS.INTELLIGENCE_CACHE_UPDATED, {
      workspaceId,
      invalidatedAt: new Date().toISOString(),
    });
  } catch { // catch-ok — broadcasting is best-effort; don't fail cache invalidation
  }

  log.info({ workspaceId, entriesDeleted: deleted }, 'Intelligence cache invalidated (in-memory + persistent + broadcast)');
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
