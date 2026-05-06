import {
  getGA4Conversions,
  getGA4EventsByPage,
  getGA4LandingPages,
  getGA4OrganicOverview,
} from './google-analytics.js';
import {
  getQueryPageData,
  getSearchCountryBreakdown,
  getSearchDeviceBreakdown,
  getSearchPeriodComparison,
} from './search-console.js';
import { createLogger } from './logger.js';
import { isProgrammingError } from './errors.js';
import type { Workspace } from '../shared/types/workspace.js';

const log = createLogger('keyword-strategy');

interface FetchKeywordStrategySearchDataOptions {
  ws: Workspace & { webflowSiteId: string };
  sendProgress: (step: string, detail: string, progress: number) => void;
}

export interface KeywordStrategySearchData {
  gscData: Array<{ query: string; page: string; clicks: number; impressions: number; position: number }>;
  deviceBreakdown: Awaited<ReturnType<typeof getSearchDeviceBreakdown>>;
  countryBreakdown: Awaited<ReturnType<typeof getSearchCountryBreakdown>>;
  periodComparison: Awaited<ReturnType<typeof getSearchPeriodComparison>> | null;
  organicLandingPages: Awaited<ReturnType<typeof getGA4LandingPages>>;
  organicOverview: Awaited<ReturnType<typeof getGA4OrganicOverview>> | null;
  ga4Conversions: Awaited<ReturnType<typeof getGA4Conversions>>;
  ga4EventsByPage: Awaited<ReturnType<typeof getGA4EventsByPage>>;
}

export async function fetchKeywordStrategySearchData({
  ws,
  sendProgress,
}: FetchKeywordStrategySearchDataOptions): Promise<KeywordStrategySearchData> {
  sendProgress('search_data', 'Fetching Google Search Console data...', 0.48);
  let gscData: KeywordStrategySearchData['gscData'] = [];
  let deviceBreakdown: KeywordStrategySearchData['deviceBreakdown'] = [];
  let countryBreakdown: KeywordStrategySearchData['countryBreakdown'] = [];
  let periodComparison: KeywordStrategySearchData['periodComparison'] = null;
  if (ws.gscPropertyUrl) {
    try {
      const [qpData, devices, countries, comparison] = await Promise.all([
        getQueryPageData(ws.webflowSiteId, ws.gscPropertyUrl, 90),
        getSearchDeviceBreakdown(ws.webflowSiteId, ws.gscPropertyUrl, 28).catch(() => []),
        getSearchCountryBreakdown(ws.webflowSiteId, ws.gscPropertyUrl, 28, 10).catch(() => []),
        getSearchPeriodComparison(ws.webflowSiteId, ws.gscPropertyUrl, 28).catch(() => null),
      ]);
      gscData = qpData;
      deviceBreakdown = devices;
      countryBreakdown = countries;
      periodComparison = comparison;
      sendProgress('search_data', `Got ${gscData.length} query rows, ${devices.length} devices, ${countries.length} countries from GSC`, 0.50);
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error');
      sendProgress('search_data', 'GSC unavailable — continuing without it', 0.50);
      log.info('Keyword strategy: GSC data unavailable, proceeding without it');
    }
  } else {
    sendProgress('search_data', 'No GSC connected — skipping', 0.50);
  }

  let organicLandingPages: KeywordStrategySearchData['organicLandingPages'] = [];
  let organicOverview: KeywordStrategySearchData['organicOverview'] = null;
  let ga4Conversions: KeywordStrategySearchData['ga4Conversions'] = [];
  let ga4EventsByPage: KeywordStrategySearchData['ga4EventsByPage'] = [];
  if (ws.ga4PropertyId) {
    try {
      sendProgress('search_data', 'Fetching GA4 organic + conversion data...', 0.51);
      const [landing, organic, conversions, eventPages] = await Promise.all([
        getGA4LandingPages(ws.ga4PropertyId, 28, 25, true).catch(() => []),
        getGA4OrganicOverview(ws.ga4PropertyId, 28).catch(() => null),
        getGA4Conversions(ws.ga4PropertyId, 28).catch(() => []),
        getGA4EventsByPage(ws.ga4PropertyId, 28, { limit: 50 }).catch(() => []),
      ]);
      organicLandingPages = landing;
      organicOverview = organic;
      ga4Conversions = conversions;
      ga4EventsByPage = eventPages;
      sendProgress('search_data', `Got ${landing.length} organic landing pages, ${conversions.length} conversion events from GA4`, 0.52);
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error');
      sendProgress('search_data', 'GA4 organic data unavailable — continuing without it', 0.52);
    }
  }

  return {
    gscData,
    deviceBreakdown,
    countryBreakdown,
    periodComparison,
    organicLandingPages,
    organicOverview,
    ga4Conversions,
    ga4EventsByPage,
  };
}
