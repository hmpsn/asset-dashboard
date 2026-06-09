// tests/mocks/webflow.ts
//
// Reusable mock factory for Webflow API calls.
// Intercepts `webflowFetch` from server/webflow-client.ts and returns
// configurable responses. Captures outbound requests for assertion.
//
// Usage:
//   import { setupWebflowMocks, mockWebflowSuccess, resetWebflowMocks, getCapturedRequests } from '../mocks/webflow.js';
//   beforeEach(() => { setupWebflowMocks(); });
//   afterEach(() => { resetWebflowMocks(); });

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Captured outbound request (for asserting URL, body, token). */
export interface CapturedRequest {
  endpoint: string;
  method: string;
  body?: unknown;
  token?: string;
}

type EndpointMatcher = string | RegExp;

interface MockRule {
  matcher: EndpointMatcher;
  handler: (endpoint: string) => Response | Promise<never>;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  rules: [] as MockRule[],
  captured: [] as CapturedRequest[],
}));

function matchEndpoint(matcher: EndpointMatcher, endpoint: string): boolean {
  if (typeof matcher === 'string') return endpoint === matcher;
  return matcher.test(endpoint);
}

function findRule(endpoint: string): MockRule | undefined {
  // Last-registered rule wins (allows overrides in individual tests).
  for (let i = mockState.rules.length - 1; i >= 0; i--) {
    if (matchEndpoint(mockState.rules[i].matcher, endpoint)) return mockState.rules[i];
  }
  return undefined;
}

const mockedGetToken = vi.fn(() => 'test-webflow-token');

const mockedWebflowFetch = vi.fn(
  async (endpoint: string, options: RequestInit = {}, tokenOverride?: string) => {
    // Capture the outbound request for test assertions.
    const method = (options.method ?? 'GET').toUpperCase();
    let body: unknown | undefined;
    if (typeof options.body === 'string') {
      try {
        body = JSON.parse(options.body);
      } catch {
        body = options.body;
      }
    } else if (options.body != null) {
      body = options.body;
    }

    mockState.captured.push({
      endpoint,
      method,
      body,
      token: tokenOverride,
    });

    // Find a matching rule and return its response.
    const rule = findRule(endpoint);
    if (rule) return rule.handler(endpoint);

    // Default: 404 for unmocked endpoints (fail-loud in tests).
    return new Response(
      JSON.stringify({ error: `No mock configured for endpoint: ${endpoint}` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  },
);

async function mockedWebflowJson<T>(
  endpoint: string,
  options: RequestInit = {},
  tokenOverride?: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; errorText: string }> {
  const res = await mockedWebflowFetch(endpoint, options, tokenOverride);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorText: await res.text(),
    };
  }
  return { ok: true, data: await res.json() as T };
}

async function mockedWebflowMutation<T = undefined>(
  endpoint: string,
  options: RequestInit,
  tokenOverride?: string,
  parse: 'json' | 'none' = 'none',
): Promise<{ ok: true; data: T } | { ok: false; status: number; errorText: string }> {
  const res = await mockedWebflowFetch(endpoint, options, tokenOverride);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorText: await res.text(),
    };
  }
  if (parse === 'none') {
    return { ok: true, data: undefined as T };
  }
  return { ok: true, data: await res.json() as T };
}

async function mockedPaginateWebflow<TPage, TItem>({
  buildEndpoint,
  extractItems,
  getTotal,
  tokenOverride,
  limit = 100,
  advanceBy = 'page-size',
}: {
  buildEndpoint: (offset: number, limit: number) => string;
  extractItems: (page: TPage) => TItem[] | undefined;
  getTotal?: (page: TPage) => number | undefined;
  tokenOverride?: string;
  limit?: number;
  advanceBy?: 'items-length' | 'page-size';
}): Promise<TItem[]> {
  const allItems: TItem[] = [];
  let offset = 0;

  while (true) {
    const result = await mockedWebflowJson<TPage>(buildEndpoint(offset, limit), {}, tokenOverride);
    if (!result.ok) break;

    const items = extractItems(result.data) || [];
    allItems.push(...items);

    if (items.length === 0) break;

    offset += advanceBy === 'items-length' ? items.length : limit;

    const total = getTotal?.(result.data);
    if (typeof total === 'number') {
      if (offset >= total) break;
      continue;
    }

    if (items.length < limit) break;
  }

  return allItems;
}

vi.mock('../../server/webflow-client.js', () => ({
  getToken: mockedGetToken,
  webflowFetch: mockedWebflowFetch,
  webflowJson: mockedWebflowJson,
  webflowMutation: mockedWebflowMutation,
  paginateWebflow: mockedPaginateWebflow,
}));

// ---------------------------------------------------------------------------
// Mock response builders
// ---------------------------------------------------------------------------

/**
 * Configure mock to return a successful JSON response for matching endpoints.
 * @param endpoint  Exact string or RegExp to match against the endpoint path.
 * @param data      Response body (will be JSON-stringified). Defaults to `{}`.
 */
export function mockWebflowSuccess(endpoint: EndpointMatcher, data: unknown = {}): void {
  mockState.rules.push({
    matcher: endpoint,
    handler: () => new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

/**
 * Configure mock to return an error response for matching endpoints.
 * @param endpoint  Exact string or RegExp to match against the endpoint path.
 * @param status    HTTP status code (e.g. 401, 404, 500).
 * @param message   Error body string.
 */
export function mockWebflowError(endpoint: EndpointMatcher, status: number, message: string): void {
  mockState.rules.push({
    matcher: endpoint,
    handler: () => new Response(message, {
      status,
      headers: { 'Content-Type': 'text/plain' },
    }),
  });
}

/**
 * Configure mock to simulate a network timeout (promise that never resolves).
 * Tests using this should set a short vitest timeout or use `vi.advanceTimersByTime`.
 */
export function mockWebflowTimeout(endpoint: EndpointMatcher): void {
  mockState.rules.push({
    matcher: endpoint,
    handler: () => new Promise<never>(() => {
      // Intentionally never resolves to simulate a network timeout.
    }),
  });
}

// ---------------------------------------------------------------------------
// Captured request access
// ---------------------------------------------------------------------------

/** Return all captured outbound requests in call order. */
export function getCapturedRequests(): CapturedRequest[] {
  return [...mockState.captured];
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/** Clear all mock rules and captured requests. Call in `afterEach`. */
export function resetWebflowMocks(): void {
  mockState.rules = [];
  mockState.captured = [];
}

// ---------------------------------------------------------------------------
// Setup — call in `beforeEach`
// ---------------------------------------------------------------------------

/**
 * Mock the `server/webflow-client.js` module so that `webflowFetch` is
 * intercepted and driven by the rules configured via `mockWebflow*` helpers.
 *
 * Also mocks `getToken` to return a default test token.
 */
export function setupWebflowMocks(): void {
  resetWebflowMocks();
}
