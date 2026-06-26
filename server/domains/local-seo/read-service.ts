import { getWorkspace } from '../../workspaces.js';
import type { LocalSeoReadResponse } from '../../../shared/types/local-seo.js';
import { isUsableLocalVisibilitySnapshot, listLatestLocalVisibilitySnapshots, getLocalSeoVisibilityTrend } from './snapshot-store.js';
import { buildSuggestedLocalSeoMarkets, disabledLocalSeoSettings, listLocalSeoMarkets, readLocalSeoSettings } from './configuration-service.js';
import {
  buildLocalSeoCaps,
  buildLocalSeoReportSummary,
  getLocalSeoCompetitorBrands,
  getLocalSeoServiceGaps,
} from './visibility-read-model.js';

export function getLocalSeoReadModel(
  workspaceId: string,
  featureEnabled: boolean,
  options: { includeSnapshots?: boolean } = {},
): LocalSeoReadResponse | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  if (!featureEnabled) {
    const settings = disabledLocalSeoSettings(workspace);
    return {
      featureEnabled: false,
      settings,
      markets: [],
      suggestedMarkets: [],
      latestSnapshots: [],
      report: buildLocalSeoReportSummary({
        featureEnabled: false,
        settings,
        markets: [],
        suggestedMarkets: [],
        latestSnapshots: [],
      }),
      competitorBrands: [],
      serviceGaps: [],
      visibilityTrend: [],
      caps: buildLocalSeoCaps(settings),
    };
  }
  const settings = readLocalSeoSettings(workspace);
  const markets = listLocalSeoMarkets(workspace.id);
  const suggestedMarkets = buildSuggestedLocalSeoMarkets(workspace);
  const latestSnapshots = listLatestLocalVisibilitySnapshots(workspace.id);
  const latestUsableSnapshots = latestSnapshots.filter(isUsableLocalVisibilitySnapshot);
  const responseSnapshots = options.includeSnapshots === false ? [] : latestSnapshots;
  return {
    featureEnabled,
    settings,
    markets,
    suggestedMarkets,
    latestSnapshots: responseSnapshots,
    report: buildLocalSeoReportSummary({
      featureEnabled,
      settings,
      markets,
      suggestedMarkets,
      latestSnapshots: latestUsableSnapshots,
    }),
    competitorBrands: getLocalSeoCompetitorBrands(workspaceId),
    serviceGaps: featureEnabled ? getLocalSeoServiceGaps(workspaceId) : [],
    visibilityTrend: getLocalSeoVisibilityTrend(workspace.id),
    caps: buildLocalSeoCaps(settings),
  };
}
