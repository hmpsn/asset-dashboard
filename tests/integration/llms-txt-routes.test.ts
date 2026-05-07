import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const generateLlmsTxt = vi.fn();
const getLastGenerated = vi.fn();

vi.mock('../../server/llms-txt-generator.js', () => ({
  generateLlmsTxt: (...args: unknown[]) => generateLlmsTxt(...args),
  getLastGenerated: (...args: unknown[]) => getLastGenerated(...args),
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

async function startTestServer(): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const originalAppPassword = process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (originalAppPassword === undefined) {
          delete process.env.APP_PASSWORD;
        } else {
          process.env.APP_PASSWORD = originalAppPassword;
        }
        return err ? reject(err) : resolve();
      });
    }),
  };
}

async function get(baseUrl: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

describe('LLMs.txt routes', () => {
  let baseUrl = '';
  let stopServer: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    generateLlmsTxt.mockReset();
    getLastGenerated.mockReset();
    generateLlmsTxt.mockResolvedValue({
      content: '# Test Site\n\n- [Home](https://example.com/)',
      fullContent: '# Test Site\n\n### Home\nFull summary.',
      pageCount: 1,
      generatedAt: '2026-05-01T00:00:00.000Z',
    });
    getLastGenerated.mockReturnValue('2026-05-01T00:00:00.000Z');

    const server = await startTestServer();
    baseUrl = server.baseUrl;
    stopServer = server.stop;
  });

  afterEach(async () => {
    await stopServer?.();
    stopServer = null;
  });

  it('returns generated llms.txt JSON for a workspace', async () => {
    const res = await get(baseUrl, '/api/llms-txt/ws_route_test');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      content: '# Test Site\n\n- [Home](https://example.com/)',
      fullContent: '# Test Site\n\n### Home\nFull summary.',
      pageCount: 1,
      generatedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(generateLlmsTxt).toHaveBeenCalledWith('ws_route_test');
  });

  it('downloads the index file with text headers', async () => {
    const res = await get(baseUrl, '/api/llms-txt/ws_route_test/download');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="llms.txt"');
    expect(body).toBe('# Test Site\n\n- [Home](https://example.com/)');
  });

  it('downloads the full file with text headers', async () => {
    const res = await get(baseUrl, '/api/llms-txt/ws_route_test/download-full');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="llms-full.txt"');
    expect(body).toBe('# Test Site\n\n### Home\nFull summary.');
  });

  it('returns freshness without regenerating content', async () => {
    const res = await get(baseUrl, '/api/llms-txt/ws_route_test/freshness');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ lastGeneratedAt: '2026-05-01T00:00:00.000Z' });
    expect(getLastGenerated).toHaveBeenCalledWith('ws_route_test');
    expect(generateLlmsTxt).not.toHaveBeenCalled();
  });

  it('returns JSON 500 when generation fails', async () => {
    generateLlmsTxt.mockRejectedValueOnce(new Error('Workspace not found'));

    const res = await get(baseUrl, '/api/llms-txt/ws_missing');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Workspace not found' });
  });
});
