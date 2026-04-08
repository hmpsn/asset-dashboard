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

let rules: MockRule[] = [];
let captured: CapturedRequest[] = [];

function matchEndpoint(matcher: EndpointMatcher, endpoint: string): boolean {
  if (typeof matcher === 'string') return endpoint === matcher;
  return matcher.test(endpoint);
}

function findRule(endpoint: string): MockRule | undefined {
  // Last-registered rule wins (allows overrides in individual tests).
  for (let i = rules.length - 1; i >= 0; i--) {
    if (matchEndpoint(rules[i].matcher, endpoint)) return rules[i];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Mock response builders
// ---------------------------------------------------------------------------

/**
 * Configure mock to return a successful JSON response for matching endpoints.
 * @param endpoint  Exact string or RegExp to match against the endpoint path.
 * @param data      Response body (will be JSON-stringified). Defaults to `{}`.
 */
export function mockWebflowSuccess(endpoint: EndpointMatcher, data: unknown = {}): void {
  rules.push({
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
  rules.push({
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
  rules.push({
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
  return [...captured];
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/** Clear all mock rules and captured requests. Call in `afterEach`. */
export function resetWebflowMocks(): void {
  rules = [];
  captured = [];
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

  vi.mock('../../server/webflow-client.js', () => ({
    getToken: vi.fn(() => 'test-webflow-token'),

    webflowFetch: vi.fn(
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

        captured.push({
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
    ),
  }));
}
