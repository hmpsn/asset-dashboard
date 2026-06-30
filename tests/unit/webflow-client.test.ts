import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalToken = process.env.WEBFLOW_API_TOKEN;

describe('webflow-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.WEBFLOW_API_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.WEBFLOW_API_TOKEN;
    else process.env.WEBFLOW_API_TOKEN = originalToken;
  });

  it('getToken returns env token when present', async () => {
    process.env.WEBFLOW_API_TOKEN = 'wf_env_token';
    const { getToken } = await import('../../server/webflow-client.js');
    expect(getToken()).toBe('wf_env_token');
  });

  it('getToken returns null when env token is missing or empty', async () => {
    const { getToken } = await import('../../server/webflow-client.js');
    expect(getToken()).toBeNull();
    process.env.WEBFLOW_API_TOKEN = '';
    expect(getToken()).toBeNull();
  });

  it('webflowFetch throws when no token is available', async () => {
    const { webflowFetch } = await import('../../server/webflow-client.js');
    await expect(webflowFetch('/sites')).rejects.toThrow('WEBFLOW_API_TOKEN not configured');
  });

  it('webflowFetch uses tokenOverride and forwards request options', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { webflowFetch } = await import('../../server/webflow-client.js');

    await webflowFetch('/sites/site_1', {
      method: 'PATCH',
      body: '{"name":"New Name"}',
    }, 'wf_override_token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.webflow.com/v2/sites/site_1');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe('{"name":"New Name"}');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer wf_override_token');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('preserves custom headers when caller passes a Headers instance (regression)', async () => {
    process.env.WEBFLOW_API_TOKEN = 'wf_env_token';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { webflowFetch } = await import('../../server/webflow-client.js');

    const callerHeaders = new Headers({ 'X-Trace-Id': 'trace-123', 'Content-Type': 'application/vnd.custom+json' });
    await webflowFetch('/sites', { headers: callerHeaders });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('x-trace-id')).toBe('trace-123');
    expect(headers.get('content-type')).toBe('application/vnd.custom+json');
    expect(headers.get('authorization')).toBe('Bearer wf_env_token');
  });

  it('webflowJson returns typed success data for ok responses', async () => {
    process.env.WEBFLOW_API_TOKEN = 'wf_env_token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pages: [{ id: 'page-1' }] }),
    } as Response));
    const { webflowJson } = await import('../../server/webflow-client.js');

    const result = await webflowJson<{ pages: Array<{ id: string }> }>('/sites/site_1/pages');

    expect(result).toEqual({
      ok: true,
      data: { pages: [{ id: 'page-1' }] },
    });
  });

  it('webflowJson returns status and response text for non-ok responses', async () => {
    process.env.WEBFLOW_API_TOKEN = 'wf_env_token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    } as Response));
    const { webflowJson } = await import('../../server/webflow-client.js');

    const result = await webflowJson('/sites/site_1/pages');

    expect(result).toEqual({
      ok: false,
      status: 429,
      errorText: 'Rate limited',
    });
  });

  it('paginateWebflow advances by item count when total-based pagination needs partial pages', async () => {
    process.env.WEBFLOW_API_TOKEN = 'wf_env_token';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          nodes: [{ id: 'node-1' }, { id: 'node-2' }],
          pagination: { total: 3 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          nodes: [{ id: 'node-3' }],
          pagination: { total: 3 },
        }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { paginateWebflow } = await import('../../server/webflow-client.js');

    const result = await paginateWebflow<
      { nodes?: Array<{ id: string }>; pagination?: { total?: number } },
      { id: string }
    >({
      buildEndpoint: (offset, limit) => `/pages/page_1/dom?limit=${limit}&offset=${offset}`,
      extractItems: page => page.nodes,
      getTotal: page => page.pagination?.total,
      advanceBy: 'items-length',
    });

    expect(result.map(node => node.id)).toEqual(['node-1', 'node-2', 'node-3']);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.webflow.com/v2/pages/page_1/dom?limit=100&offset=2');
  });

  it('paginateWebflow stops after a short page when total is unavailable', async () => {
    process.env.WEBFLOW_API_TOKEN = 'wf_env_token';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          assets: Array.from({ length: 100 }, (_, index) => ({ id: `asset-${index}` })),
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          assets: [{ id: 'asset-100' }],
        }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { paginateWebflow } = await import('../../server/webflow-client.js');

    const result = await paginateWebflow<{ assets?: Array<{ id: string }> }, { id: string }>({
      buildEndpoint: (offset, limit) => `/sites/site_1/assets?limit=${limit}&offset=${offset}`,
      extractItems: page => page.assets,
    });

    expect(result).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.webflow.com/v2/sites/site_1/assets?limit=100&offset=100');
  });

  it('paginateWebflow stops after maxPages even when more items remain (network-cost bound)', async () => {
    process.env.WEBFLOW_API_TOKEN = 'wf_env_token';
    // Every page returns a FULL page with a large total → without maxPages this crawls indefinitely.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        formSubmissions: Array.from({ length: 100 }, (_, i) => ({ id: `sub-${i}` })),
        pagination: { total: 100000 },
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { paginateWebflow } = await import('../../server/webflow-client.js');

    const result = await paginateWebflow<
      { formSubmissions?: Array<{ id: string }>; pagination?: { total?: number } },
      { id: string }
    >({
      buildEndpoint: (offset, limit) => `/sites/site_1/forms/form_1/submissions?limit=${limit}&offset=${offset}`,
      extractItems: page => page.formSubmissions,
      getTotal: page => page.pagination?.total,
      maxPages: 3,
    });

    // Exactly 3 pages fetched, 300 items — bounded despite total=100000.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(300);
  });

  it('webflowMutation returns parsed JSON data when requested', async () => {
    process.env.WEBFLOW_API_TOKEN = 'wf_env_token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'asset-1' }),
    } as Response));
    const { webflowMutation } = await import('../../server/webflow-client.js');

    const result = await webflowMutation<{ id: string }>(
      '/assets',
      { method: 'POST', body: '{"name":"hero.jpg"}' },
      undefined,
      'json',
    );

    expect(result).toEqual({
      ok: true,
      data: { id: 'asset-1' },
    });
  });

  it('webflowMutation returns status and error text for failed writes', async () => {
    process.env.WEBFLOW_API_TOKEN = 'wf_env_token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'Validation failed',
    } as Response));
    const { webflowMutation } = await import('../../server/webflow-client.js');

    const result = await webflowMutation('/assets', { method: 'POST' });

    expect(result).toEqual({
      ok: false,
      status: 422,
      errorText: 'Validation failed',
    });
  });
});
