import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// C2 migrated generation to the background job platform: POST /generate returns
// { jobId } (covered in tests/integration/c2-ai-to-jobs.test.ts). The GET routes
// here serve the result persisted by the job runner via getStoredResult() and
// never trigger a fresh crawl — that read-path contract is what this file covers.
const getStoredResult = vi.fn();
const getLastGenerated = vi.fn();

vi.mock('../../server/llms-txt-generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/llms-txt-generator.js')>();
  return {
    ...actual,
    getStoredResult: (...args: unknown[]) => getStoredResult(...args),
    getLastGenerated: (...args: unknown[]) => getLastGenerated(...args),
  };
});

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

const storedResult = {
  content: '# Test Site\n\n- [Home](https://example.com/)',
  fullContent: '# Test Site\n\n### Home\nFull summary.',
  pageCount: 1,
  generatedAt: '2026-05-01T00:00:00.000Z',
};

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
    getStoredResult.mockReset();
    getLastGenerated.mockReset();
    getStoredResult.mockReturnValue(storedResult);
    getLastGenerated.mockReturnValue('2026-05-01T00:00:00.000Z');

    const server = await startTestServer();
    baseUrl = server.baseUrl;
    stopServer = server.stop;
  });

  afterEach(async () => {
    await stopServer?.();
    stopServer = null;
  });

  it('returns the stored llms.txt result as JSON without regenerating', async () => {
    const res = await get(baseUrl, '/api/llms-txt/ws_route_test');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(storedResult);
    expect(getStoredResult).toHaveBeenCalledWith('ws_route_test');
  });

  it('returns 404 JSON when no result has been stored yet', async () => {
    getStoredResult.mockReturnValue(null);

    const res = await get(baseUrl, '/api/llms-txt/ws_route_test');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('No LLMs.txt has been generated yet');
  });

  it('downloads the stored index file with text headers', async () => {
    const res = await get(baseUrl, '/api/llms-txt/ws_route_test/download');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="llms.txt"');
    expect(body).toBe('# Test Site\n\n- [Home](https://example.com/)');
  });

  it('downloads the stored full file with text headers', async () => {
    const res = await get(baseUrl, '/api/llms-txt/ws_route_test/download-full');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="llms-full.txt"');
    expect(body).toBe('# Test Site\n\n### Home\nFull summary.');
  });

  it('returns 404 on download when no result has been stored yet', async () => {
    getStoredResult.mockReturnValue(null);

    const res = await get(baseUrl, '/api/llms-txt/ws_route_test/download');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('No LLMs.txt has been generated yet');
  });

  it('returns freshness without reading the stored result', async () => {
    const res = await get(baseUrl, '/api/llms-txt/ws_route_test/freshness');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ lastGeneratedAt: '2026-05-01T00:00:00.000Z' });
    expect(getLastGenerated).toHaveBeenCalledWith('ws_route_test');
    expect(getStoredResult).not.toHaveBeenCalled();
  });
});
