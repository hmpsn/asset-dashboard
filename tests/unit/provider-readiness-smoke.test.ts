import { describe, expect, it, vi } from 'vitest';

import {
  parseProviderReadinessSmokeOptions,
  runProviderReadinessSmoke,
} from '../../scripts/provider-readiness-smoke.js';

describe('provider readiness smoke', () => {
  it('parses a secret-safe staging profile with a bounded paid-call budget', () => {
    const options = parseProviderReadinessSmokeOptions([], {
      STAGING_BASE_URL: 'https://staging.example.com/',
      STAGING_WORKSPACE_ID: 'ws-stage',
      APP_PASSWORD: 'secret-value',
      PROVIDER_SMOKE_MAX_PAID_CALLS: '0',
    });

    expect(options).toMatchObject({
      profile: 'staging',
      baseUrl: 'https://staging.example.com',
      workspaceId: 'ws-stage',
      maxPaidCalls: 0,
    });
  });

  it('rejects non-HTTPS remote targets', () => {
    expect(() => parseProviderReadinessSmokeOptions([], {
      STAGING_BASE_URL: 'http://staging.example.com',
      STAGING_WORKSPACE_ID: 'ws-stage',
      APP_PASSWORD: 'secret-value',
    })).toThrow('base URL must use HTTPS');
  });

  it('refuses the production platform origin', () => {
    expect(() => parseProviderReadinessSmokeOptions([], {
      STAGING_BASE_URL: 'https://insights.hmpsn.studio',
      STAGING_WORKSPACE_ID: 'ws-stage',
      APP_PASSWORD: 'secret-value',
    })).toThrow('refuses the production platform origin');
  });

  it('uses GET-only probes and skips paid provider calls when budget is zero', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(init?.method).toBe('GET');
      if (url.endsWith('/api/workspaces/ws-stage')) {
        return new Response(JSON.stringify({
          webflowSiteId: 'site-stage',
          gscPropertyUrl: 'sc-domain:example.com',
          competitorDomains: ['competitor.example'],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/google-business-profile/status')) {
        return new Response(JSON.stringify({ configured: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const report = await runProviderReadinessSmoke({
      profile: 'staging',
      baseUrl: 'https://staging.example.com',
      workspaceId: 'ws-stage',
      appPassword: 'secret-value',
      maxPaidCalls: 0,
    }, fetchMock as typeof fetch);

    expect(report.readOnly).toBe(true);
    expect(report.probes.find(probe => probe.key === 'dataforseo')?.status).toBe('skipped');
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some(url => url.includes('/discover-competitors/'))).toBe(false);
    expect(urls.some(url => /sync|publish|disconnect/i.test(url))).toBe(false);
  });
});
