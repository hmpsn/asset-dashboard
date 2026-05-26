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
});
