/**
 * Integration test for the The Issue (Client) P0 outcome-value AI-enrich endpoint:
 *   POST /api/workspaces/:id/outcome-value-enrich
 *
 * The endpoint is an ADVISORY proposer — it returns a low-confidence { valuePerOutcome, unitLabel }
 * estimate and NEVER persists it (the admin confirms via the standard workspace PATCH carrying
 * basis: 'ai_enriched'). Verifies:
 * - success → 200 + { valuePerOutcome, unitLabel }; workspace.outcomeValue stays unset (no persist)
 * - unknown workspace → 404
 * - AI failure → 502 (FM-2 honest degradation, never a fabricated number)
 *
 * Runs in-process via createApp() so the hoisted vi.mock of server/openai-helpers.js intercepts
 * the callAI → callOpenAI delegation (a child-process server would not see the mock).
 */

// ── Module-level mocks (hoisted by Vitest) ───────────────────────────────────
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  setupOpenAIMocks,
  mockOpenAIJsonResponse,
  mockOpenAIError,
  resetOpenAIMocks,
} from '../mocks/openai.js';

setupOpenAIMocks();

// ── Imports (after mock declarations) ────────────────────────────────────────
import { createWorkspace, deleteWorkspace, getWorkspace } from '../../server/workspaces.js';
import { signAdminToken } from '../../server/middleware.js';

const FEATURE = 'the-issue-lead-value-enrich';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let adminToken = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server!.close(err => (err ? reject(err) : resolve())));
  server = undefined;
}

async function enrich(id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${id}/outcome-value-enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': adminToken },
    body: JSON.stringify({}),
  });
}

beforeAll(async () => {
  await startTestServer();
  adminToken = signAdminToken();
  wsId = createWorkspace('Outcome Value Enrich WS').id;
}, 40_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await stopTestServer();
});

beforeEach(() => {
  resetOpenAIMocks();
});

describe('POST /api/workspaces/:id/outcome-value-enrich', () => {
  it('returns the AI estimate and does NOT persist it', async () => {
    mockOpenAIJsonResponse(FEATURE, { valuePerOutcome: 750, unitLabel: 'new patient' });
    const res = await enrich(wsId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valuePerOutcome).toBe(750);
    expect(body.unitLabel).toBe('new patient');
    // Advisory: the workspace outcomeValue must stay unset until the admin PATCHes.
    expect(getWorkspace(wsId)?.outcomeValue == null).toBe(true);
  });

  it('returns 404 for an unknown workspace', async () => {
    mockOpenAIJsonResponse(FEATURE, { valuePerOutcome: 750, unitLabel: 'new patient' });
    const res = await enrich('does-not-exist-uuid');
    expect(res.status).toBe(404);
  });

  it('returns 502 when the AI enrich fails (honest degradation, no fabricated number)', async () => {
    mockOpenAIError(FEATURE, 'simulated AI outage');
    const res = await enrich(wsId);
    expect(res.status).toBe(502);
    // Still nothing persisted.
    expect(getWorkspace(wsId)?.outcomeValue == null).toBe(true);
  });
});
