import type {
  IntelligenceOptions,
  IntelligenceSlice,
  WorkspaceIntelligence,
} from '../../shared/types/intelligence.js';
import { createLogger } from '../logger.js';
import { assembleClientSignals } from './client-signals-slice.js';
import { assembleContentPipeline } from './content-pipeline-slice.js';
import { assembleEeatAssets } from './eeat-assets-slice.js';
import { assembleEntityResolution } from './entity-resolution-slice.js';
import { assembleGenerationQuality } from './generation-quality-slice.js';
import { assembleInsights } from './insights-slice.js';
import { assembleLearnings } from './learnings-slice.js';
import { assembleLocalSeo } from './local-seo-slice.js';
import { assembleOperational } from './operational-slice.js';
import { assemblePageElements } from './page-elements-slice.js';
import { assemblePageProfile } from './page-profile-slice.js';
import { assembleSeoContext } from './seo-context-slice.js';
import { assembleSiteHealth } from './site-health-slice.js';
import { assembleSiteInventory } from './site-inventory-slice.js';

const log = createLogger('workspace-intelligence');

export interface IntelligenceSliceMetadataEntry {
  assemble: (
    workspaceId: string,
    opts?: IntelligenceOptions,
  ) => Promise<Partial<WorkspaceIntelligence>>;
  requiredOptions?: Partial<Record<'pagePath' | 'siteId' | 'siteBaseUrl', true>>;
}

async function assembleWithTimeout<T>(
  slice: IntelligenceSlice,
  workspaceId: string,
  timeoutMs: number,
  factory: () => Promise<T>,
): Promise<T | undefined> {
  let timedOut = false;
  const pending = factory().catch((err) => {
    if (timedOut) return undefined;
    throw err;
  });

  try {
    const result = await Promise.race<T | undefined>([
      pending,
      new Promise<undefined>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
    if (timedOut) {
      log.warn({ workspaceId, slice, timeoutMs }, `${slice} slice assembly failed — skipping`);
    }
    return result;
  } catch (err) {
    log.warn({ workspaceId, slice, err }, `${slice} slice assembly failed — skipping`);
    return undefined;
  }
}

export const INTELLIGENCE_SLICE_METADATA_REGISTRY = {
  seoContext: {
    assemble: async (workspaceId, opts) => ({
      seoContext: await assembleSeoContext(workspaceId, opts),
    }),
  },
  insights: {
    assemble: async (workspaceId, opts) => ({
      insights: await assembleInsights(workspaceId, opts),
    }),
  },
  learnings: {
    assemble: async (workspaceId, opts) => ({
      learnings: await assembleLearnings(workspaceId, opts),
    }),
  },
  pageProfile: {
    requiredOptions: { pagePath: true },
    assemble: async (workspaceId, opts) => ({
      pageProfile: await assemblePageProfile(workspaceId, opts!.pagePath!, opts),
    }),
  },
  contentPipeline: {
    assemble: async (workspaceId) => ({
      contentPipeline: await assembleContentPipeline(workspaceId),
    }),
  },
  siteHealth: {
    assemble: async (workspaceId, opts) => {
      const siteHealth = await assembleWithTimeout(
        'siteHealth',
        workspaceId,
        5000,
        () => assembleSiteHealth(workspaceId, opts),
      );
      return siteHealth ? { siteHealth } : {};
    }
  },
  clientSignals: {
    assemble: async (workspaceId, opts) => ({
      clientSignals: await assembleClientSignals(workspaceId, opts),
    }),
  },
  operational: {
    assemble: async (workspaceId, opts) => ({
      operational: await assembleOperational(workspaceId, opts),
    }),
  },
  pageElements: {
    requiredOptions: { pagePath: true },
    assemble: async (workspaceId, opts) => ({
      pageElements: await assemblePageElements(workspaceId, opts!.pagePath!),
    }),
  },
  siteInventory: {
    requiredOptions: { siteId: true, siteBaseUrl: true },
    assemble: async (workspaceId, opts) => ({
      siteInventory: await assembleSiteInventory(
        workspaceId,
        opts!.siteId!,
        opts!.siteBaseUrl!,
        opts?.webflowToken,
      ),
    }),
  },
  localSeo: {
    assemble: async (workspaceId) => ({
      localSeo: await assembleLocalSeo(workspaceId),
    }),
  },
  entityResolution: {
    assemble: async (workspaceId, opts) => ({
      entityResolution: await assembleEntityResolution(workspaceId, opts),
    }),
  },
  eeatAssets: {
    assemble: async (workspaceId) => ({
      eeatAssets: await assembleEeatAssets(workspaceId),
    }),
  },
  generationQuality: {
    assemble: async (workspaceId) => ({
      generationQuality: await assembleGenerationQuality(workspaceId),
    }),
  },
} as const satisfies Record<IntelligenceSlice, IntelligenceSliceMetadataEntry>;

export function canAssembleIntelligenceSlice(
  entry: IntelligenceSliceMetadataEntry,
  opts?: IntelligenceOptions,
): boolean {
  if (!entry.requiredOptions) return true;
  if (entry.requiredOptions.pagePath && !opts?.pagePath) return false;
  if (entry.requiredOptions.siteId && !opts?.siteId) return false;
  if (entry.requiredOptions.siteBaseUrl && !opts?.siteBaseUrl) return false;
  return true;
}
