import type {
  IntelligenceOptions,
  IntelligenceSlice,
  WorkspaceIntelligence,
} from '../../shared/types/intelligence.js';
import { createLogger } from '../logger.js';

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
    assemble: async (workspaceId, opts) => {
      const { assembleSeoContext } = await import('./seo-context-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { seoContext: await assembleSeoContext(workspaceId, opts) };
    },
  },
  insights: {
    assemble: async (workspaceId, opts) => {
      const { assembleInsights } = await import('./insights-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { insights: await assembleInsights(workspaceId, opts) };
    },
  },
  learnings: {
    assemble: async (workspaceId, opts) => {
      const { assembleLearnings } = await import('./learnings-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { learnings: await assembleLearnings(workspaceId, opts) };
    },
  },
  pageProfile: {
    requiredOptions: { pagePath: true },
    assemble: async (workspaceId, opts) => {
      const { assemblePageProfile } = await import('./page-profile-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { pageProfile: await assemblePageProfile(workspaceId, opts!.pagePath!, opts) };
    },
  },
  contentPipeline: {
    assemble: async (workspaceId) => {
      const { assembleContentPipeline } = await import('./content-pipeline-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { contentPipeline: await assembleContentPipeline(workspaceId) };
    },
  },
  siteHealth: {
    assemble: async (workspaceId, opts) => {
      const { assembleSiteHealth } = await import('./site-health-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
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
    assemble: async (workspaceId, opts) => {
      const { assembleClientSignals } = await import('./client-signals-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { clientSignals: await assembleClientSignals(workspaceId, opts) };
    },
  },
  operational: {
    assemble: async (workspaceId, opts) => {
      const { assembleOperational } = await import('./operational-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { operational: await assembleOperational(workspaceId, opts) };
    },
  },
  pageElements: {
    requiredOptions: { pagePath: true },
    assemble: async (workspaceId, opts) => {
      const { assemblePageElements } = await import('./page-elements-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { pageElements: await assemblePageElements(workspaceId, opts!.pagePath!) };
    },
  },
  siteInventory: {
    requiredOptions: { siteId: true, siteBaseUrl: true },
    assemble: async (workspaceId, opts) => {
      const { assembleSiteInventory } = await import('./site-inventory-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return {
        siteInventory: await assembleSiteInventory(
        workspaceId,
        opts!.siteId!,
        opts!.siteBaseUrl!,
        opts?.webflowToken,
        ),
      };
    },
  },
  localSeo: {
    assemble: async (workspaceId) => {
      const { assembleLocalSeo } = await import('./local-seo-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { localSeo: await assembleLocalSeo(workspaceId) };
    },
  },
  entityResolution: {
    assemble: async (workspaceId, opts) => {
      const { assembleEntityResolution } = await import('./entity-resolution-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { entityResolution: await assembleEntityResolution(workspaceId, opts) };
    },
  },
  eeatAssets: {
    assemble: async (workspaceId) => {
      const { assembleEeatAssets } = await import('./eeat-assets-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { eeatAssets: await assembleEeatAssets(workspaceId) };
    },
  },
  generationQuality: {
    assemble: async (workspaceId) => {
      const { assembleGenerationQuality } = await import('./generation-quality-slice.js'); // dynamic-import-ok — slice registry intentionally lazy-loads typed module exports to avoid facade cycles.
      return { generationQuality: await assembleGenerationQuality(workspaceId) };
    },
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
