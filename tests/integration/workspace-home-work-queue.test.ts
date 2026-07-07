import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import { createHmac } from 'crypto';
import { Socket } from 'net';
import type express from 'express';

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { setBroadcast } from '../../server/broadcast.js';
import type { WorkQueueClassification } from '../../shared/types/work-queue.js';

let app: express.Express;
let wsId = '';
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'asset-dashboard-test-session-secret';
const adminAuthToken = createHmac('sha256', SESSION_SECRET).update('admin').digest('hex');

beforeAll(async () => {
  process.env.APP_PASSWORD = '';
  process.env.SESSION_SECRET = SESSION_SECRET;
  setBroadcast(() => {}, () => {});
  const { createApp } = await import('../../server/app.js');
  app = createApp();
  wsId = createWorkspace('Workspace Home Work Queue WS').id;
}, 60_000);

afterAll(async () => {
  deleteWorkspace(wsId);
});

async function appGet(path: string): Promise<{ status: number; json: () => Promise<unknown> }> {
  const socket = new Socket();
  const req = new http.IncomingMessage(socket);
  req.method = 'GET';
  req.url = path;
  req.headers = {
    host: '127.0.0.1',
    'x-auth-token': adminAuthToken,
  };

  const res = new http.ServerResponse(req);
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    const finish = () => {
      const body = Buffer.concat(chunks).toString('utf8');
      resolve({
        status: res.statusCode,
        json: async () => (body ? new Response(body).json() : null),
      });
    };

    res.write = ((chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : undefined));
      if (typeof encoding === 'function') encoding();
      if (cb) cb();
      return true;
    }) as typeof res.write;

    res.end = ((chunk?: unknown, encoding?: BufferEncoding | (() => void), cb?: () => void) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : undefined));
      if (typeof encoding === 'function') encoding();
      if (cb) cb();
      finish();
      return res;
    }) as typeof res.end;

    app(req, res, (error: unknown) => {
      if (error) reject(error);
      else finish();
    });
  });
}

describe('GET /api/workspace-home/:id — workQueue', () => {
  it('serializes the additive server-classified workQueue field with count parity', async () => {
    const res = await appGet(`/api/workspace-home/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { workQueue?: WorkQueueClassification; requests?: unknown[] };

    expect(Array.isArray(body.requests)).toBe(true);
    expect(body.workQueue).toBeDefined();
    expect(body.workQueue?.items.some(item => item.id === 'setup-webflow')).toBe(true);

    const total = Object.values(body.workQueue!.streams).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(body.workQueue!.items.length);
  });
});
