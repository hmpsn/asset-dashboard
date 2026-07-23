/**
 * Integration coverage for the application-level MCP limiter.
 *
 * The limiter is deliberately registered before the MCP router in app.ts so
 * every POST transport is throttled before bearer authentication. CodeQL does
 * not model that outer custom middleware boundary, so this test pins the real
 * request path for the client profile.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import { createApp } from '../../server/app.js';

let baseUrl = '';
let server: http.Server | undefined;
let previousNodeEnv: string | undefined;

beforeAll(async () => {
  previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  server = http.createServer(createApp());
  process.env.NODE_ENV = previousNodeEnv;

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

describe('MCP client application rate-limit boundary', () => {
  it('limits unauthenticated POST requests before client-profile auth dispatch', async () => {
    for (let requestNumber = 1; requestNumber <= 120; requestNumber++) {
      const response = await fetch(`${baseUrl}/mcp/client`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(401);
    }

    const blocked = await fetch(`${baseUrl}/mcp/client`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toEqual(expect.any(String));
  });
});
