/**
 * Integration tests: SB-043 workspace archive route.
 */
import { PassThrough, Readable, Writable } from 'node:stream';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setBroadcast } from '../../server/broadcast.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

interface AppResponse {
  status: number;
  body: unknown;
}

let app: Express;
let wsId = '';

function createMockReq(path: string, method: string, body?: unknown) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  let sent = false;
  const req = new Readable({
    read() {
      if (sent) return;
      sent = true;
      if (payload) this.push(payload);
      this.push(null);
    },
  }) as Readable & {
    method: string;
    url: string;
    headers: Record<string, string>;
    connection: Record<string, unknown>;
    socket: Record<string, unknown>;
  };
  const socket = new PassThrough();
  req.method = method;
  req.url = path;
  req.headers = payload
    ? { 'content-type': 'application/json', 'content-length': String(payload.length) }
    : {};
  req.connection = socket;
  req.socket = socket;
  return req;
}

function appRequest(path: string, init: { method?: string; body?: unknown } = {}): Promise<AppResponse> {
  const method = init.method ?? 'GET';
  const req = createMockReq(path, method, init.body);
  const chunks: Buffer[] = [];
  const headers = new Map<string, string | number | readonly string[]>();

  return new Promise((resolve, reject) => {
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        callback();
      },
    }) as Writable & {
      statusCode: number;
      headersSent: boolean;
      setHeader: (name: string, value: string | number | readonly string[]) => void;
      getHeader: (name: string) => string | number | readonly string[] | undefined;
      removeHeader: (name: string) => void;
      writeHead: (statusCode: number, headers?: Record<string, string | number | readonly string[]>) => typeof res;
      end: (chunk?: unknown, encoding?: BufferEncoding | (() => void), callback?: () => void) => typeof res;
    };

    res.statusCode = 200;
    res.headersSent = false;
    res.setHeader = (name, value) => {
      headers.set(name.toLowerCase(), value);
    };
    res.getHeader = (name) => headers.get(name.toLowerCase());
    res.removeHeader = (name) => {
      headers.delete(name.toLowerCase());
    };
    res.writeHead = (statusCode, nextHeaders) => {
      res.statusCode = statusCode;
      res.headersSent = true;
      for (const [name, value] of Object.entries(nextHeaders ?? {})) {
        res.setHeader(name, value);
      }
      return res;
    };
    res.end = (chunk?: unknown, encoding?: BufferEncoding | (() => void), callback?: () => void) => {
      if (chunk != null && typeof chunk !== 'function') {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let parsed: unknown = raw;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = raw;
      }
      resolve({ status: res.statusCode, body: parsed });
      const cb = typeof encoding === 'function' ? encoding : callback;
      cb?.();
      return res;
    };

    app.handle(req, res, reject);
  });
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  setBroadcast(() => {}, () => {});
  const mod = await import('../../server/app.js');
  app = mod.createApp();
  wsId = createWorkspace('Archive Endpoint WS 178').id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(wsId);
});

describe('PATCH /api/workspaces/:id/archive', () => {
  it('archives, excludes from default lists, logs activity, and restores', async () => {
    const archiveRes = await appRequest(`/api/workspaces/${wsId}/archive`, {
      method: 'PATCH',
      body: { archived: true },
    });
    expect(archiveRes.status).toBe(200);
    const archived = archiveRes.body as { id: string; archivedAt: string | null };
    expect(archived.id).toBe(wsId);
    expect(typeof archived.archivedAt).toBe('string');

    const listRes = await appRequest('/api/workspaces');
    expect(listRes.status).toBe(200);
    const list = listRes.body as Array<{ id: string }>;
    expect(list.some((workspace) => workspace.id === wsId)).toBe(false);

    const overviewRes = await appRequest('/api/workspace-overview');
    expect(overviewRes.status).toBe(200);
    const overview = overviewRes.body as Array<{ id: string }>;
    expect(overview.some((workspace) => workspace.id === wsId)).toBe(false);

    const detailRes = await appRequest(`/api/workspaces/${wsId}`);
    expect(detailRes.status).toBe(200);
    const detail = detailRes.body as { archivedAt: string | null };
    expect(detail.archivedAt).toBe(archived.archivedAt);

    const activityRes = await appRequest(`/api/activity?workspaceId=${wsId}&limit=5`);
    expect(activityRes.status).toBe(200);
    const activity = activityRes.body as Array<{ type: string; title: string }>;
    expect(activity.some((entry) => entry.type === 'workspace_archived')).toBe(true);

    const restoreRes = await appRequest(`/api/workspaces/${wsId}/archive`, {
      method: 'PATCH',
      body: { archived: false },
    });
    expect(restoreRes.status).toBe(200);
    const restored = restoreRes.body as { archivedAt: string | null };
    expect(restored.archivedAt).toBeNull();

    const restoredListRes = await appRequest('/api/workspaces');
    const restoredList = restoredListRes.body as Array<{ id: string }>;
    expect(restoredList.some((workspace) => workspace.id === wsId)).toBe(true);
  });
});
