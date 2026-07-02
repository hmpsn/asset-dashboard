/**
 * Integration test for the admin MCP API key management routes
 * (`server/routes/mcp-api-keys.ts`) — the backend behind the Settings UI.
 *
 * Exercises the REAL HTTP path end-to-end against the spawned test server:
 *   create (plaintext shown once) → list (no secret material leaks) →
 *   the minted key authenticates at /mcp → revoke → the key is rejected at /mcp.
 * Plus the 404 on an unknown workspace.
 *
 * This is the read path that actually backs the admin surface, so a regression in
 * route wiring, scoping, or the revoke→reject loop is caught here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createEphemeralTestContext(import.meta.url);

let ws: ReturnType<typeof seedWorkspace>;

beforeAll(async () => {
  await ctx.startServer();
  ws = seedWorkspace();
});

afterAll(async () => {
  ws.cleanup();
  await ctx.stopServer();
});

async function adminPost(body: unknown): Promise<Response> {
  return ctx.api('/api/admin/mcp-api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Drive the /mcp handshake + a tools/list call with a Bearer token; returns the HTTP status. */
async function mcpToolsListStatus(token: string): Promise<number> {
  await ctx.api('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'key-test', version: '1.0' } },
      id: 0,
    }),
  });
  const res = await ctx.api('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
  });
  return res.status;
}

describe('Admin MCP API key routes', () => {
  it('creates a key (plaintext shown once), lists it without leaking secret material, and the key authenticates at /mcp', async () => {
    // CREATE
    const createRes = await adminPost({ workspaceId: ws.workspaceId, label: 'integration-test-key' });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as {
      key: { id: string; workspaceId: string; workspaceName: string; label: string; revoked: boolean };
      plaintextKeyOnceShown: string;
    };
    expect(created.plaintextKeyOnceShown).toMatch(/^mcp_/);
    expect(created.key.workspaceId).toBe(ws.workspaceId);
    expect(created.key.label).toBe('integration-test-key');
    expect(created.key.revoked).toBe(false);

    // LIST — the key appears, and NO secret material (plaintext or hash) is exposed.
    const listRes = await ctx.api('/api/admin/mcp-api-keys', { method: 'GET' });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      keys: Array<Record<string, unknown>>;
      masterKeyConfigured: boolean;
    };
    const row = listBody.keys.find((k) => k.id === created.key.id);
    expect(row, 'created key is present in the list').toBeTruthy();
    const serialized = JSON.stringify(listBody);
    expect(serialized).not.toContain(created.plaintextKeyOnceShown);
    expect(serialized).not.toContain('key_hash');
    expect(serialized).not.toContain('keyHash');

    // The minted key authenticates at /mcp.
    expect(await mcpToolsListStatus(created.plaintextKeyOnceShown)).toBe(200);

    // REVOKE → the same key is now rejected at /mcp (fail-closed).
    const revokeRes = await ctx.api(`/api/admin/mcp-api-keys/${created.key.id}`, { method: 'DELETE' });
    expect(revokeRes.status).toBe(200);
    expect(await mcpToolsListStatus(created.plaintextKeyOnceShown)).toBe(401);

    // A second revoke is idempotent-at-store but reports 409 (already revoked).
    const reRevoke = await ctx.api(`/api/admin/mcp-api-keys/${created.key.id}`, { method: 'DELETE' });
    expect(reRevoke.status).toBe(409);

    // The revoked key still shows in the list, now flagged revoked.
    const list2 = (await (await ctx.api('/api/admin/mcp-api-keys', { method: 'GET' })).json()) as {
      keys: Array<{ id: string; revoked: boolean }>;
    };
    expect(list2.keys.find((k) => k.id === created.key.id)?.revoked).toBe(true);
  });

  it('rejects creation for an unknown workspace with 404', async () => {
    const res = await adminPost({ workspaceId: 'ws_does_not_exist', label: 'nope' });
    expect(res.status).toBe(404);
  });

  it('rejects revoking an unknown key id with 404', async () => {
    const res = await ctx.api('/api/admin/mcp-api-keys/not-a-real-id', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
