/**
 * Mock factory for Google Search Console (GSC), GA4, and OAuth API calls.
 *
 * Uses vi.spyOn(globalThis, 'fetch') with a URL-matching router so multiple
 * mock rules can coexist (e.g. GSC success + OAuth refresh in the same test).
 *
 * Usage:
 *   beforeEach(() => setupGoogleMocks());
 *   afterEach(() => resetGoogleMocks());
 *   // then in your test:
 *   mockGSCResponse({ rows: [{ keys: ['seo tools'], clicks: 42, impressions: 1000, ctr: 0.042, position: 3.2 }] });
 */

import { vi, type MockInstance } from 'vitest';

// ── Types ──

interface GSCRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GA4Row {
  dimensionValues: Array<{ value: string }>;
  metricValues: Array<{ value: string }>;
}

interface MockRule {
  pattern: RegExp;
  response: () => Response;
}

// ── Internal state ──

let fetchSpy: MockInstance | null = null;
const rules: MockRule[] = [];

/**
 * Core URL router. When fetch is called, the first matching rule wins.
 * If no rule matches, returns a generic 500 so tests fail loudly.
 */
function routeFetch(input: string | URL | Request, _init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  for (const rule of rules) {
    if (rule.pattern.test(url)) {
      return Promise.resolve(rule.response());
    }
  }

  // No matching rule -- fail loudly so the test knows it hit an unmocked endpoint
  return Promise.resolve(
    new Response(JSON.stringify({ error: 'No mock rule matched this URL' }), { status: 500 }),
  );
}

// ── GSC Mocks ──

/**
 * Mock a successful GSC searchAnalytics/query response.
 * URL pattern: googleapis.com/webmasters/v3/sites/.../searchAnalytics/query
 */
export function mockGSCResponse(data?: { rows?: GSCRow[] }): void {
  const body = { rows: data?.rows ?? [] };
  rules.push({
    pattern: /googleapis\.com\/webmasters\/v3\/sites\/.*\/searchAnalytics\/query/,
    response: () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

/**
 * Mock a GSC API error (e.g. 403 forbidden, 429 rate limited).
 */
export function mockGSCError(status: number, message: string): void {
  rules.push({
    pattern: /googleapis\.com\/webmasters\/v3\/sites\/.*\/searchAnalytics\/query/,
    response: () => new Response(JSON.stringify({ error: { message, code: status } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

/**
 * Mock the GSC sites list endpoint.
 */
export function mockGSCSitesList(sites?: Array<{ siteUrl: string; permissionLevel: string }>): void {
  rules.push({
    pattern: /googleapis\.com\/webmasters\/v3\/sites$/,
    response: () => new Response(JSON.stringify({ siteEntry: sites ?? [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

// ── GA4 Mocks ──

/**
 * Mock a successful GA4 runReport response.
 * URL pattern: analyticsdata.googleapis.com/v1beta/properties/...:runReport
 */
export function mockGA4Response(data?: { rows?: GA4Row[] }): void {
  const body = { rows: data?.rows ?? [] };
  rules.push({
    pattern: /analyticsdata\.googleapis\.com\/v1beta\/properties\/.*:runReport/,
    response: () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

/**
 * Mock a GA4 API error.
 */
export function mockGA4Error(status: number, message: string): void {
  rules.push({
    pattern: /analyticsdata\.googleapis\.com\/v1beta\/properties\/.*:runReport/,
    response: () => new Response(JSON.stringify({ error: { message, code: status } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

/**
 * Mock the GA4 Admin accountSummaries endpoint (used by listGA4Properties).
 */
export function mockGA4AccountSummaries(
  summaries?: Array<{
    account: string;
    displayName: string;
    propertySummaries?: Array<{ property: string; displayName: string }>;
  }>,
): void {
  rules.push({
    pattern: /analyticsadmin\.googleapis\.com\/v1beta\/accountSummaries/,
    response: () => new Response(
      JSON.stringify({ accountSummaries: summaries ?? [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

// ── OAuth Mocks ──

/**
 * Mock a successful OAuth2 token refresh.
 * URL pattern: oauth2.googleapis.com/token
 */
export function mockOAuthRefresh(accessToken?: string): void {
  rules.push({
    pattern: /oauth2\.googleapis\.com\/token/,
    response: () => new Response(
      JSON.stringify({
        access_token: accessToken ?? 'mock-access-token-refreshed',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

/**
 * Mock an OAuth2 token refresh failure.
 */
export function mockOAuthRefreshError(status: number, message: string): void {
  rules.push({
    pattern: /oauth2\.googleapis\.com\/token/,
    response: () => new Response(
      JSON.stringify({ error: message, error_description: message }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

// ── Setup / Reset ──

/**
 * Install the fetch spy with the URL router.
 * Call in beforeEach(). Rules added via mock*() functions are evaluated
 * in insertion order (first match wins).
 */
export function setupGoogleMocks(): void {
  resetGoogleMocks();
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(routeFetch as typeof fetch);
}

/**
 * Clear all rules and restore the original fetch.
 * Call in afterEach().
 */
export function resetGoogleMocks(): void {
  rules.length = 0;
  if (fetchSpy) {
    fetchSpy.mockRestore();
    fetchSpy = null;
  }
}

// ── Convenience helpers for common test scenarios ──

/**
 * Default GSC response with realistic sample data.
 * Good for smoke tests that just need a non-empty response.
 */
export function mockGSCWithSampleData(): void {
  mockGSCResponse({
    rows: [
      { keys: ['seo tools'], clicks: 150, impressions: 3200, ctr: 0.047, position: 4.2 },
      { keys: ['analytics platform'], clicks: 89, impressions: 1800, ctr: 0.049, position: 6.1 },
      { keys: ['rank tracking'], clicks: 42, impressions: 900, ctr: 0.047, position: 8.3 },
    ],
  });
}

/**
 * Default GA4 response with realistic sample data (overview metrics format).
 */
export function mockGA4WithSampleData(): void {
  mockGA4Response({
    rows: [{
      dimensionValues: [],
      metricValues: [
        { value: '1250' },   // totalUsers
        { value: '1800' },   // sessions
        { value: '4200' },   // screenPageViews
        { value: '145.5' },  // averageSessionDuration
        { value: '42.3' },   // bounceRate
        { value: '800' },    // newUsers
      ],
    }],
  });
}

/**
 * Set up all Google mocks with default happy-path responses.
 * Includes GSC, GA4, and OAuth refresh.
 */
export function mockAllGoogleDefaults(): void {
  mockGSCWithSampleData();
  mockGA4WithSampleData();
  mockOAuthRefresh();
}
