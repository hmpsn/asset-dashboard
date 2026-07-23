import { isLocalFakeProviderModeEnabled } from '../local-provider-mode.js';
import type { PageSpeedResult, SiteSpeedResult } from '../pagespeed-types.js';

export const LOCAL_PROVIDER_FIXTURE = {
  workspaceId: 'ws_demo_provider_rich',
  siteId: 'site_demo_provider_rich',
  domain: 'provider-rich-demo.local',
  gscPropertyUrl: 'sc-domain:provider-rich-demo.local',
  ga4PropertyId: 'properties/100005',
  ga4PropertyNumericId: '100005',
  businessName: 'Provider Rich Studio',
  gbpPlaceId: 'place_provider_rich_primary',
  capturedAt: '2026-07-10T12:00:00.000Z',
} as const;

export const LOCAL_PROVIDER_FIXTURE_TOKEN = 'local-provider-fixture-token';

function normalizeDomain(value: string): string {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
  } catch (err) {
    void err;
    return value.replace(/^https?:\/\//, '').split('/')[0]?.toLowerCase() ?? '';
  }
}

function normalizePropertyId(value: string): string {
  return value.replace(/^properties\//, '');
}

export function isLocalProviderFixtureWorkspace(workspaceId: string | undefined): boolean {
  return isLocalFakeProviderModeEnabled() && workspaceId === LOCAL_PROVIDER_FIXTURE.workspaceId;
}

export function isLocalProviderFixtureSite(siteId: string | undefined): boolean {
  return isLocalFakeProviderModeEnabled() && siteId === LOCAL_PROVIDER_FIXTURE.siteId;
}

export function isLocalProviderFixtureProperty(propertyId: string | undefined): boolean {
  return isLocalFakeProviderModeEnabled()
    && normalizePropertyId(propertyId ?? '') === LOCAL_PROVIDER_FIXTURE.ga4PropertyNumericId;
}

export function isLocalProviderFixtureDomain(value: string | undefined): boolean {
  return isLocalFakeProviderModeEnabled()
    && normalizeDomain(value ?? '') === LOCAL_PROVIDER_FIXTURE.domain;
}

interface GscFixtureBody {
  startDate?: string;
  endDate?: string;
  dimensions?: string[];
  rowLimit?: number;
  startRow?: number;
  type?: string;
}

interface GscFixtureRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function isoDates(startDate?: string, endDate?: string, maxDays = 28): string[] {
  const fallbackEnd = new Date('2026-07-07T00:00:00.000Z');
  const parsedEnd = endDate ? new Date(`${endDate}T00:00:00.000Z`) : fallbackEnd;
  const safeEnd = Number.isFinite(parsedEnd.getTime()) ? parsedEnd : fallbackEnd;
  const parsedStart = startDate ? new Date(`${startDate}T00:00:00.000Z`) : new Date(safeEnd);
  if (!startDate) parsedStart.setUTCDate(parsedStart.getUTCDate() - maxDays + 1);
  const safeStart = Number.isFinite(parsedStart.getTime()) && parsedStart <= safeEnd
    ? parsedStart
    : new Date(safeEnd);
  const spanDays = Math.floor((safeEnd.getTime() - safeStart.getTime()) / 86_400_000) + 1;
  const count = Math.min(maxDays, Math.max(1, spanDays));
  const first = new Date(safeEnd);
  first.setUTCDate(first.getUTCDate() - count + 1);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function gscRow(keys: string[], clicks: number, impressions: number, position: number): GscFixtureRow {
  return {
    keys,
    clicks: Math.round(clicks),
    impressions: Math.round(impressions),
    ctr: impressions > 0 ? clicks / impressions : 0,
    position,
  };
}

function gscPeriodScale(endDate?: string): number {
  const ordinal = Math.floor((Date.parse(`${endDate ?? '2026-07-07'}T00:00:00.000Z`) - Date.parse('2026-01-01T00:00:00.000Z')) / 86_400_000);
  return Math.max(0.72, 1 + ordinal * 0.001);
}

export function buildLocalGscFixtureResponse(
  endpoint: string,
  rawBody?: Record<string, unknown>,
): unknown {
  if (endpoint.endsWith('/sites')) {
    return { siteEntry: [{ siteUrl: LOCAL_PROVIDER_FIXTURE.gscPropertyUrl, permissionLevel: 'siteOwner' }] };
  }

  const encodedProperty = encodeURIComponent(LOCAL_PROVIDER_FIXTURE.gscPropertyUrl);
  if (!endpoint.includes(encodedProperty) && !endpoint.includes(LOCAL_PROVIDER_FIXTURE.gscPropertyUrl)) {
    return { rows: [] };
  }

  const body = (rawBody ?? {}) as GscFixtureBody;
  if ((body.startRow ?? 0) > 0) return { rows: [] };
  const dimensions = body.dimensions ?? [];
  const scale = gscPeriodScale(body.endDate);
  const limit = Math.max(1, body.rowLimit ?? 500);
  const pages = ['/', '/services/seo', '/work', '/insights', '/about'].map((path) => `https://${LOCAL_PROVIDER_FIXTURE.domain}${path}`);
  const queries = ['seo agency austin', 'technical seo studio', 'organic growth strategy', 'seo reporting agency', 'content strategy austin'];
  let rows: GscFixtureRow[];

  if (dimensions.join(',') === 'query') {
    rows = queries.map((query, index) => gscRow([query], (168 - index * 22) * scale, 2_420 - index * 270, 3.2 + index * 1.3));
  } else if (dimensions.join(',') === 'page') {
    rows = pages.map((page, index) => gscRow([page], (205 - index * 27) * scale, 3_120 - index * 310, 4.1 + index * 1.1));
  } else if (dimensions.join(',') === 'date') {
    rows = isoDates(body.startDate, body.endDate).map((date, index) => gscRow([date], 18 + index * 1.3, 410 + index * 18, 6.8 - index * 0.035));
  } else if (dimensions.join(',') === 'query,date') {
    rows = isoDates(body.startDate, body.endDate, 14).flatMap((date, dateIndex) => queries.map((query, queryIndex) => (
      gscRow([query, date], 2 + dateIndex * 0.2 + queryIndex, 42 + dateIndex * 2 + queryIndex * 6, 3.5 + queryIndex)
    )));
  } else if (dimensions.join(',') === 'query,page') {
    rows = queries.map((query, index) => gscRow([query, pages[index]], 92 - index * 9, 1_240 - index * 120, 3.1 + index));
  } else if (dimensions.join(',') === 'date,page') {
    rows = isoDates(body.startDate, body.endDate, 14).flatMap((date, index) => [
      gscRow([date, pages[0]], 9 + index, 175 + index * 5, 4.2),
      gscRow([date, pages[1]], 6 + index * 0.7, 122 + index * 4, 5.4),
    ]);
  } else if (dimensions.join(',') === 'device') {
    rows = [gscRow(['DESKTOP'], 442, 7_680, 5.2), gscRow(['MOBILE'], 318, 6_030, 6.4), gscRow(['TABLET'], 24, 610, 7.1)];
  } else if (dimensions.join(',') === 'country') {
    rows = [gscRow(['usa'], 731, 12_490, 5.5), gscRow(['can'], 31, 720, 7.2), gscRow(['gbr'], 22, 530, 7.8), gscRow(['aus'], 15, 390, 8.4)];
  } else {
    const typeScale: Record<string, number> = { web: 1, image: 0.14, video: 0.06, news: 0.03, discover: 0.09 };
    const factor = typeScale[body.type ?? 'web'] ?? 1;
    rows = [gscRow([], 784 * scale * factor, 14_320 * scale * factor, 5.7)];
  }

  return { rows: rows.slice(0, limit) };
}

interface Ga4FixtureBody {
  dimensions?: Array<{ name?: string }>;
  metrics?: Array<{ name?: string }>;
  dateRanges?: Array<{ startDate?: string; endDate?: string; name?: string }>;
  dimensionFilter?: unknown;
  limit?: number | string;
}

type Ga4MetricValues = Record<string, number>;

function ga4Row(dimensions: string[], metricNames: string[], values: Ga4MetricValues) {
  return {
    dimensionValues: dimensions.map((value) => ({ value })),
    metricValues: metricNames.map((name) => ({ value: String(values[name] ?? 0) })),
  };
}

function ga4MetricSet(users: number, sessions = Math.round(users * 1.42), pageviews = Math.round(sessions * 1.72)): Ga4MetricValues {
  return {
    totalUsers: users,
    sessions,
    engagedSessions: Math.round(sessions * 0.686),
    screenPageViews: pageviews,
    averageSessionDuration: 148.6,
    bounceRate: 0.314,
    newUsers: Math.round(users * 0.61),
    eventCount: Math.round(sessions * 3.4),
    userEngagementDuration: Math.round(sessions * 102.4),
    keyEvents: Math.round(users * 0.071),
    engagementRate: 0.686,
  };
}

function ga4MetricType(name: string): 'TYPE_FLOAT' | 'TYPE_INTEGER' | 'TYPE_SECONDS' {
  if (name === 'engagementRate' || name === 'bounceRate' || name === 'keyEvents') {
    return 'TYPE_FLOAT';
  }
  if (name === 'averageSessionDuration' || name === 'userEngagementDuration') {
    return 'TYPE_SECONDS';
  }
  return 'TYPE_INTEGER';
}

export function buildLocalGa4FixtureReport(rawBody: Record<string, unknown>): unknown {
  const body = rawBody as Ga4FixtureBody;
  const dimensions = (body.dimensions ?? []).map((dimension) => dimension.name ?? '');
  const metricNames = (body.metrics ?? []).map((metric) => metric.name ?? '');
  const dimensionKey = dimensions.join(',');
  const limit = Math.max(1, Number(body.limit ?? 100));
  let rows: ReturnType<typeof ga4Row>[];

  if (dimensionKey === 'date') {
    rows = isoDates(body.dateRanges?.[0]?.startDate, body.dateRanges?.[0]?.endDate).map((date, index) => (
      ga4Row([date.replaceAll('-', '')], metricNames, ga4MetricSet(72 + index * 3, 98 + index * 4, 181 + index * 7))
    ));
  } else if (dimensionKey === 'pagePath') {
    rows = [
      ['/', 510, 722, 1_430], ['/services/seo', 394, 551, 1_008], ['/work', 287, 388, 704],
      ['/insights', 244, 332, 681], ['/about', 161, 211, 358],
    ].map(([path, users, sessions, views]) => ga4Row([String(path)], metricNames, ga4MetricSet(Number(users), Number(sessions), Number(views))));
  } else if (dimensionKey === 'sessionSource,sessionMedium') {
    rows = [
      ['google', 'organic', 1_284, 1_716], ['(direct)', '(none)', 421, 562], ['linkedin.com', 'referral', 219, 286], ['bing', 'organic', 174, 229],
    ].map(([source, medium, users, sessions]) => ga4Row([String(source), String(medium)], metricNames, ga4MetricSet(Number(users), Number(sessions))));
  } else if (dimensionKey === 'sessionCampaignName') {
    rows = [
      ['Organic Search', 1_109, 1_492], ['(direct)', 421, 562], ['Q3 authority campaign', 278, 361], ['Partner referral', 193, 251],
    ].map(([campaign, users, sessions]) => ga4Row([String(campaign)], metricNames, ga4MetricSet(Number(users), Number(sessions))));
  } else if (dimensionKey === 'deviceCategory') {
    rows = [['desktop', 1_310, 1_780], ['mobile', 861, 1_132], ['tablet', 93, 121]].map(([device, users, sessions]) => (
      ga4Row([String(device)], metricNames, ga4MetricSet(Number(users), Number(sessions)))
    ));
  } else if (dimensionKey === 'country') {
    rows = [['United States', 1_884, 2_531], ['Canada', 142, 189], ['United Kingdom', 103, 137], ['Australia', 76, 102]].map(([country, users, sessions]) => (
      ga4Row([String(country)], metricNames, ga4MetricSet(Number(users), Number(sessions)))
    ));
  } else if (dimensionKey === 'newVsReturning') {
    rows = [['new', 1_381, 1_782], ['returning', 883, 1_251]].map(([segment, users, sessions]) => (
      ga4Row([String(segment)], metricNames, ga4MetricSet(Number(users), Number(sessions)))
    ));
  } else if (dimensionKey === 'eventName') {
    rows = [['generate_lead', 148, 121], ['contact_submit', 92, 81], ['book_consultation', 61, 54], ['download_case_study', 49, 44]].map(([event, count, users]) => (
      ga4Row([String(event)], metricNames, { ...ga4MetricSet(Number(users)), eventCount: Number(count), keyEvents: Number(count) })
    ));
  } else if (dimensionKey === 'eventName,pagePath') {
    rows = [
      ['generate_lead', '/services/seo', 71, 58], ['contact_submit', '/', 43, 39], ['book_consultation', '/work', 31, 28],
    ].map(([event, path, count, users]) => ga4Row([String(event), String(path)], metricNames, { ...ga4MetricSet(Number(users)), eventCount: Number(count) }));
  } else if (dimensionKey === 'landingPage') {
    rows = [
      ['/', 612, 478], ['/services/seo', 493, 367], ['/work', 328, 252], ['/insights', 281, 218], ['/about', 184, 142],
    ].map(([path, sessions, users]) => ga4Row([String(path)], metricNames, ga4MetricSet(Number(users), Number(sessions))));
  } else {
    const organic = JSON.stringify(body.dimensionFilter ?? {}).includes('Organic Search');
    rows = (body.dateRanges ?? [{}]).map((_, index) => ga4Row([], metricNames, ga4MetricSet(
      Math.round(2_264 * (organic ? 0.62 : 1) * (index === 0 ? 1 : 0.86)),
      Math.round(3_033 * (organic ? 0.64 : 1) * (index === 0 ? 1 : 0.84)),
      Math.round(5_218 * (organic ? 0.66 : 1) * (index === 0 ? 1 : 0.82)),
    )));
  }

  const rowCount = rows.length;
  const returnedRows = rows.slice(0, limit);
  const multipleRanges = (body.dateRanges?.length ?? 0) > 1;
  if (multipleRanges) {
    returnedRows.forEach((row, index) => {
      const rangeName = body.dateRanges?.[index]?.name;
      row.dimensionValues.push({ value: rangeName ?? `date_range_${index}` });
    });
  }

  return {
    dimensionHeaders: [
      ...dimensions.map(name => ({ name })),
      ...(multipleRanges ? [{ name: 'dateRange' }] : []),
    ],
    metricHeaders: metricNames.map(name => ({ name, type: ga4MetricType(name) })),
    rows: returnedRows,
    rowCount,
    metadata: {
      subjectToThresholding: false,
      dataLossFromOtherRow: false,
    },
    kind: 'analyticsData#runReport',
  };
}

function localPageSpeedResult(
  path: string,
  title: string,
  strategy: 'mobile' | 'desktop',
  scoreOffset = 0,
): PageSpeedResult {
  const mobile = strategy === 'mobile';
  const score = (mobile ? 78 : 92) + scoreOffset;
  const lcp = mobile ? 2_720 : 1_840;
  const inp = mobile ? 238 : 146;
  const cls = mobile ? 0.12 : 0.06;
  return {
    url: `https://${LOCAL_PROVIDER_FIXTURE.domain}${path}`,
    page: title,
    strategy,
    score,
    vitals: {
      LCP: lcp,
      FID: mobile ? 96 : 58,
      CLS: cls,
      FCP: mobile ? 1_740 : 1_110,
      INP: inp,
      SI: mobile ? 3_040 : 1_920,
      TBT: mobile ? 286 : 112,
      TTI: mobile ? 3_780 : 2_210,
    },
    cwvAssessment: {
      assessment: mobile ? 'needs-improvement' : 'good',
      fieldDataAvailable: true,
      metrics: {
        LCP: { value: lcp, rating: mobile ? 'needs-improvement' : 'good' },
        INP: { value: inp, rating: mobile ? 'needs-improvement' : 'good' },
        CLS: { value: cls, rating: mobile ? 'needs-improvement' : 'good' },
      },
    },
    opportunities: [
      {
        id: 'render-blocking-resources',
        title: 'Eliminate render-blocking resources',
        description: 'Defer non-critical styles and scripts until after the first render.',
        savings: mobile ? '0.7 s' : '0.3 s',
        score: mobile ? 0.46 : 0.71,
      },
      {
        id: 'modern-image-formats',
        title: 'Serve images in next-gen formats',
        description: 'Use efficient image formats for large case-study media.',
        savings: '184 KB',
        score: 0.68,
      },
    ],
    diagnostics: [
      {
        id: 'mainthread-work-breakdown',
        title: 'Minimize main-thread work',
        description: 'Reduce script evaluation during initial navigation.',
        displayValue: mobile ? '2.4 s' : '1.1 s',
      },
    ],
    fetchedAt: LOCAL_PROVIDER_FIXTURE.capturedAt,
    fieldDataAvailable: true,
  };
}

export function buildLocalPageSpeedFixture(
  url: string,
  strategy: 'mobile' | 'desktop',
  pageTitle = '',
): PageSpeedResult | null {
  if (!isLocalProviderFixtureDomain(url)) return null;
  let path = '/';
  try {
    path = new URL(url).pathname || '/';
  } catch (err) {
    void err;
    return null;
  }
  const result = localPageSpeedResult(path, pageTitle || path, strategy);
  return { ...result, url };
}

export function buildLocalSiteSpeedFixture(
  siteId: string,
  strategy: 'mobile' | 'desktop',
  maxPages: number,
  workspaceId?: string,
): SiteSpeedResult | null {
  if (!isLocalProviderFixtureSite(siteId) || (workspaceId && !isLocalProviderFixtureWorkspace(workspaceId))) {
    return null;
  }
  return createLocalSiteSpeedFixture(strategy, maxPages);
}

export function createLocalSiteSpeedFixture(
  strategy: 'mobile' | 'desktop',
  maxPages = 5,
): SiteSpeedResult {
  const definitions = [
    ['/', 'Home', 2],
    ['/services/seo', 'SEO Services', 0],
    ['/work', 'Selected Work', -3],
    ['/insights/organic-growth', 'Organic Growth Insights', -1],
    ['/about', 'About', 1],
  ] as const;
  const pages = definitions
    .slice(0, Math.max(0, maxPages))
    .map(([path, title, scoreOffset]) => localPageSpeedResult(path, title, strategy, scoreOffset));
  const averageScore = pages.length > 0
    ? Math.round(pages.reduce((sum, page) => sum + page.score, 0) / pages.length)
    : 0;
  const averageVital = (key: keyof PageSpeedResult['vitals']): number | null => {
    const values = pages.map((page) => page.vitals[key]).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const averageVitals: SiteSpeedResult['averageVitals'] = {
    LCP: averageVital('LCP'),
    FID: averageVital('FID'),
    CLS: averageVital('CLS'),
    FCP: averageVital('FCP'),
    INP: averageVital('INP'),
    SI: averageVital('SI'),
    TBT: averageVital('TBT'),
    TTI: averageVital('TTI'),
  };

  return {
    siteId: LOCAL_PROVIDER_FIXTURE.siteId,
    strategy,
    pages,
    averageScore,
    averageVitals,
    testedAt: LOCAL_PROVIDER_FIXTURE.capturedAt,
  };
}
