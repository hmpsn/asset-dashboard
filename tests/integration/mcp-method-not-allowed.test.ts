/**
 * Integration test for the MCP endpoint's handling of non-POST methods.
 *
 * ROOT CAUSE this locks in: the MCP router only registered `POST /`. A Streamable
 * HTTP client opens `GET /mcp` to establish the optional server→client SSE
 * notification stream (and sends `DELETE /mcp` to tear a session down). With no
 * GET/DELETE handler, those requests fell through to the SPA catch-all
 * (`app.get('*')`) and returned `200` + index.html instead of the spec-correct
 * `405 Method Not Allowed`. The client read the non-SSE `200` as an
 * instantly-closed stream and reconnected in a tight loop, flooding `GET /mcp`
 * and exhausting the shared per-IP `${ip}:/mcp` rate-limit bucket — so real
 * `POST /mcp` tool calls (the asset-manager feature) started getting `429`.
 *
 * Per the MCP Streamable HTTP spec, a server that does not offer the GET SSE
 * stream MUST return 405. These cases assert that contract so the loop can never
 * come back.
 *
 * In-process server pattern (http.createServer(createApp()) on port 0,
 * APP_PASSWORD unset), mirror of competitor-alerts-route.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import { createApp } from '../../server/app.js';

let baseUrl = '';
let server: http.Server | undefined;

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

describe('MCP endpoint — non-POST methods', () => {
  it('GET /mcp responds 405 with an Allow: POST header (no SPA fallthrough)', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    // Must NOT be the SPA catch-all serving HTML — that is the bug.
    expect(res.headers.get('content-type') || '').not.toContain('text/html');
  });

  it('DELETE /mcp responds 405 with an Allow: POST header', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
