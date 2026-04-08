/**
 * Mock factory for SEMRush API calls.
 *
 * The real SEMRush client (server/semrush.ts) uses fetch against api.semrush.com
 * and returns CSV-formatted responses. This mock intercepts fetch calls by URL
 * pattern and returns either CSV or error responses.
 *
 * WARNING: Cannot be active simultaneously with setupGoogleMocks() — both
 * spy on globalThis.fetch. Use only one per test file, or build a shared
 * fetch router if both are needed.
 *
 * Usage:
 *   beforeEach(() => setupSEMRushMocks());
 *   afterEach(() => resetSEMRushMocks());
 *   mockSEMRushKeywordData([{ keyword: 'seo tools', volume: 12000, difficulty: 65, cpc: 3.5 }]);
 */

import { vi, type MockInstance } from 'vitest';

// ── Types ──

interface KeywordData {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  competition?: number;
  results?: number;
  trend?: number[];
}

interface MockRule {
  pattern: RegExp;
  response: () => Response;
}

// ── Internal state ──

let fetchSpy: MockInstance | null = null;
const rules: MockRule[] = [];
let circuitOpen = false;

/**
 * Core URL router. First matching rule wins.
 * If the circuit breaker is tripped, all SEMRush API calls get the credit-exhausted error.
 */
function routeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  // Circuit breaker: intercept all semrush.com calls
  if (circuitOpen && /api\.semrush\.com/.test(url)) {
    return Promise.resolve(
      new Response('ERROR 120 :: API UNITS BALANCE IS ZERO', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );
  }

  for (const rule of rules) {
    if (rule.pattern.test(url)) {
      return Promise.resolve(rule.response());
    }
  }

  // Not a SEMRush URL -- pass through to any other spy or fail
  return Promise.resolve(
    new Response(JSON.stringify({ error: 'No mock rule matched this URL' }), { status: 500 }),
  );
}

// ── Helpers ──

/**
 * Convert keyword data to SEMRush CSV format.
 * SEMRush uses semicolon-delimited CSV with specific column headers.
 * Columns: Ph (phrase), Nq (volume), Kd (difficulty), Cp (CPC),
 *          Co (competition), Nr (results), Td (trend, comma-separated).
 */
function keywordsToCSV(keywords: KeywordData[]): string {
  const headers = 'Ph;Nq;Kd;Cp;Co;Nr;Td';
  const rows = keywords.map(kw => {
    const trend = kw.trend?.join(',') ?? '';
    return `${kw.keyword};${kw.volume};${kw.difficulty};${kw.cpc};${kw.competition ?? 0};${kw.results ?? 0};${trend}`;
  });
  return [headers, ...rows].join('\n');
}

/**
 * Convert domain overview data to SEMRush CSV format.
 * Columns: Dn (domain), Or (organic keywords), Ot (organic traffic),
 *          Oc (organic cost), Ad (paid keywords), At (paid traffic), Ac (paid cost).
 */
function domainOverviewToCSV(data: Record<string, unknown>): string {
  const headers = 'Dn;Or;Ot;Oc;Ad;At;Ac';
  const row = [
    data.domain ?? 'example.com',
    data.organicKeywords ?? 1500,
    data.organicTraffic ?? 8000,
    data.organicCost ?? 12500,
    data.paidKeywords ?? 50,
    data.paidTraffic ?? 200,
    data.paidCost ?? 800,
  ].join(';');
  return `${headers}\n${row}`;
}

// ── Mock Functions ──

/**
 * Mock the SEMRush domain overview (domain_ranks) endpoint.
 * Matches: api.semrush.com with type=domain_ranks in query params.
 */
export function mockSEMRushDomainOverview(data?: Record<string, unknown>): void {
  const csv = domainOverviewToCSV(data ?? {});
  rules.push({
    pattern: /api\.semrush\.com.*type=domain_ranks/,
    response: () => new Response(csv, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    }),
  });
}

/**
 * Mock the SEMRush keyword overview (phrase_all) endpoint.
 * Matches: api.semrush.com with type=phrase_all in query params.
 */
export function mockSEMRushKeywordData(data?: KeywordData[]): void {
  const keywords = data ?? [
    { keyword: 'seo tools', volume: 12000, difficulty: 65, cpc: 3.5 },
    { keyword: 'analytics platform', volume: 5400, difficulty: 45, cpc: 2.8 },
  ];
  const csv = keywordsToCSV(keywords);
  rules.push({
    pattern: /api\.semrush\.com.*type=phrase_all/,
    response: () => new Response(csv, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    }),
  });
}

/**
 * Mock the SEMRush domain organic keywords endpoint.
 * Matches: api.semrush.com with type=domain_organic in query params.
 */
export function mockSEMRushDomainOrganic(
  data?: Array<{
    keyword: string;
    position: number;
    volume: number;
    difficulty: number;
    cpc: number;
    url: string;
    traffic: number;
    trafficPercent: number;
  }>,
): void {
  const defaults = data ?? [
    { keyword: 'seo tools', position: 4, volume: 12000, difficulty: 65, cpc: 3.5, url: 'https://example.com/seo-tools', traffic: 850, trafficPercent: 12.5 },
  ];
  const headers = 'Ph;Po;Nq;Kd;Cp;Ur;Tr;Tc;Td;Sf';
  const rows = defaults.map(d =>
    `${d.keyword};${d.position};${d.volume};${d.difficulty};${d.cpc};${d.url};${d.traffic};${d.trafficPercent};;`,
  );
  const csv = [headers, ...rows].join('\n');
  rules.push({
    pattern: /api\.semrush\.com.*type=domain_organic/,
    response: () => new Response(csv, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    }),
  });
}

/**
 * Mock a SEMRush API error. SEMRush returns errors as 200 OK with
 * "ERROR <code> :: <message>" in the body (CSV format).
 * Common errors:
 *   - 120: "API UNITS BALANCE IS ZERO" (credits exhausted)
 *   - 50:  "NOTHING FOUND" (no data for query)
 *   - 40:  rate limited
 *
 * For HTTP-level errors (e.g. 500, 503), pass useHttpStatus=true.
 */
export function mockSEMRushError(
  status: number,
  message: string,
  options?: { useHttpStatus?: boolean },
): void {
  if (options?.useHttpStatus) {
    // Actual HTTP error response
    rules.push({
      pattern: /api\.semrush\.com/,
      response: () => new Response(message, {
        status,
        headers: { 'Content-Type': 'text/plain' },
      }),
    });
  } else {
    // SEMRush-style error: 200 OK with ERROR in body
    rules.push({
      pattern: /api\.semrush\.com/,
      response: () => new Response(`ERROR ${status} :: ${message}`, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    });
  }
}

/**
 * Simulate the credit-exhausted circuit breaker being tripped.
 * All subsequent SEMRush API calls will return the "BALANCE IS ZERO" error
 * until resetSEMRushMocks() is called.
 */
export function mockSEMRushCircuitOpen(): void {
  circuitOpen = true;
}

// ── Backlinks Mocks ──

/**
 * Mock the SEMRush backlinks overview endpoint.
 * Matches: api.semrush.com/analytics/v1 with type=backlinks_overview.
 */
export function mockSEMRushBacklinksOverview(data?: {
  totalBacklinks?: number;
  referringDomains?: number;
  followLinks?: number;
  nofollowLinks?: number;
}): void {
  const d = {
    totalBacklinks: data?.totalBacklinks ?? 2500,
    referringDomains: data?.referringDomains ?? 180,
    followLinks: data?.followLinks ?? 2000,
    nofollowLinks: data?.nofollowLinks ?? 500,
  };
  const headers = 'total;domains_num;urls_num;ips_num;follows_num;nofollows_num;texts_num;images_num;forms_num;frames_num';
  const row = `${d.totalBacklinks};${d.referringDomains};0;0;${d.followLinks};${d.nofollowLinks};0;0;0;0`;
  const csv = `${headers}\n${row}`;
  rules.push({
    pattern: /api\.semrush\.com\/analytics\/v1.*type=backlinks_overview/,
    response: () => new Response(csv, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    }),
  });
}

// ── Setup / Reset ──

/**
 * Install the fetch spy with the URL router.
 * Call in beforeEach(). Rules added via mock*() functions are
 * evaluated in insertion order (first match wins).
 */
export function setupSEMRushMocks(): void {
  resetSEMRushMocks();
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(routeFetch as typeof fetch);
}

/**
 * Clear all rules, reset circuit breaker, and restore the original fetch.
 * Call in afterEach().
 */
export function resetSEMRushMocks(): void {
  rules.length = 0;
  circuitOpen = false;
  if (fetchSpy) {
    fetchSpy.mockRestore();
    fetchSpy = null;
  }
}

// ── Convenience helpers ──

/**
 * Set up all SEMRush mocks with default happy-path responses.
 * Covers keyword overview, domain overview, domain organic, and backlinks.
 */
export function mockAllSEMRushDefaults(): void {
  mockSEMRushKeywordData();
  mockSEMRushDomainOverview();
  mockSEMRushDomainOrganic();
  mockSEMRushBacklinksOverview();
}
