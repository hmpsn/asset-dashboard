import type {
  LocalSeoKeywordVisibilitySummary,
  LocalSeoMarket,
  LocalSeoRepeatCompetitor,
  LocalSeoServiceGap,
  LocalVisibilitySnapshot,
} from '../../../shared/types/local-seo.js';
import { createLogger } from '../../logger.js';
import type { LocalSeoKeywordCandidate } from './types.js';

const log = createLogger('local-seo/intelligence-read-model');

function localSeoModulePath(name: string): string {
  return `./${name}.js`;
}

const candidateServiceModule = localSeoModulePath('candidate-service');
const configurationServiceModule = localSeoModulePath('configuration-service');
const snapshotStoreModule = localSeoModulePath('snapshot-store');
const visibilityReadModelModule = localSeoModulePath('visibility-read-model');

interface CandidateServiceModule {
  buildLocalSeoKeywordCandidates(workspaceId: string): LocalSeoKeywordCandidate[];
}

interface ConfigurationServiceModule {
  listLocalSeoMarkets(workspaceId: string): LocalSeoMarket[];
}

interface SnapshotStoreModule {
  buildLocalSeoKeywordVisibilitySummaryByKey(workspaceId: string): Map<string, LocalSeoKeywordVisibilitySummary>;
  listLatestLocalVisibilitySnapshots(workspaceId: string): LocalVisibilitySnapshot[];
}

interface VisibilityReadModelModule {
  getLocalSeoServiceGaps(workspaceId: string): LocalSeoServiceGap[];
  getLocalSeoCompetitorBrands(workspaceId: string): LocalSeoRepeatCompetitor[];
}

export interface LocalSeoIntelligenceInputs {
  markets: LocalSeoMarket[];
  candidates: LocalSeoKeywordCandidate[];
  visibilityByKey: Map<string, LocalSeoKeywordVisibilitySummary>;
  latestSnapshots: LocalVisibilitySnapshot[];
  serviceGaps: LocalSeoServiceGap[];
  competitorBrands: LocalSeoRepeatCompetitor[];
}

export interface LocalSeoIntelligenceOptionalInputs {
  latestSnapshots: LocalVisibilitySnapshot[];
  serviceGaps: LocalSeoServiceGap[];
  competitorBrands: LocalSeoRepeatCompetitor[];
}

function emptyLocalSeoIntelligenceInputs(markets: LocalSeoMarket[] = []): LocalSeoIntelligenceInputs {
  return {
    markets,
    candidates: [],
    visibilityByKey: new Map(),
    latestSnapshots: [],
    serviceGaps: [],
    competitorBrands: [],
  };
}

export async function loadLocalSeoIntelligenceInputs(workspaceId: string): Promise<LocalSeoIntelligenceInputs> {
  const configurationService = await import(configurationServiceModule) as ConfigurationServiceModule; // dynamic-import-ok - typed by narrow read-boundary interface.
  const markets = configurationService.listLocalSeoMarkets(workspaceId);
  if (markets.length === 0) return emptyLocalSeoIntelligenceInputs(markets);

  const [candidateService, snapshotStore] = await Promise.all([
    import(candidateServiceModule) as Promise<CandidateServiceModule>, // dynamic-import-ok - typed by narrow read-boundary interface.
    import(snapshotStoreModule) as Promise<SnapshotStoreModule>, // dynamic-import-ok - typed by narrow read-boundary interface.
  ]);

  return {
    markets,
    candidates: candidateService.buildLocalSeoKeywordCandidates(workspaceId),
    visibilityByKey: snapshotStore.buildLocalSeoKeywordVisibilitySummaryByKey(workspaceId),
    ...await loadLocalSeoOptionalIntelligenceInputs(workspaceId),
  };
}

export async function loadLocalSeoOptionalIntelligenceInputs(workspaceId: string): Promise<LocalSeoIntelligenceOptionalInputs> {
  let latestSnapshots: LocalVisibilitySnapshot[] = [];
  try {
    const snapshotStore = await import(snapshotStoreModule) as SnapshotStoreModule; // dynamic-import-ok - typed by narrow read-boundary interface.
    latestSnapshots = snapshotStore.listLatestLocalVisibilitySnapshots(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'latest snapshot lookup failed; leaving empty');
  }

  let serviceGaps: LocalSeoServiceGap[] = [];
  try {
    const visibilityReadModel = await import(visibilityReadModelModule) as VisibilityReadModelModule; // dynamic-import-ok - typed by narrow read-boundary interface.
    serviceGaps = visibilityReadModel.getLocalSeoServiceGaps(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'service gaps unavailable for local SEO intelligence input; leaving empty');
  }

  let competitorBrands: LocalSeoRepeatCompetitor[] = [];
  try {
    const visibilityReadModel = await import(visibilityReadModelModule) as VisibilityReadModelModule; // dynamic-import-ok - typed by narrow read-boundary interface.
    competitorBrands = visibilityReadModel.getLocalSeoCompetitorBrands(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'competitor brands unavailable for local SEO intelligence input; leaving empty');
  }

  return {
    latestSnapshots,
    serviceGaps,
    competitorBrands,
  };
}
