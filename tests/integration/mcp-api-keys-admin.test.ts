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
import db from '../../server/db/index.js';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const ctx = createEphemeralTestContext(import.meta.url);

let ws: ReturnType<typeof seedWorkspace>;
let createdContentRequestId: string | undefined;

beforeAll(async () => {
  await ctx.startServer();
  ws = seedWorkspace();
});

afterAll(async () => {
  await ctx.stopServer();
  if (createdContentRequestId && ws) {
    db.prepare('DELETE FROM content_topic_requests WHERE id = ? AND workspace_id = ?')
      .run(createdContentRequestId, ws.workspaceId);
  }
  ws?.cleanup();
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

async function callMcpTool<T>(
  token: string,
  requestId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: T; responseRequestId: string }> {
  const res = await ctx.api('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'X-Request-ID': requestId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args },
      id: 2,
    }),
  });

  expect(res.status).toBe(200);
  const responseRequestId = res.headers.get('x-request-id');
  expect(responseRequestId).toBeTruthy();
  const body = await res.json() as {
    result?: { isError?: boolean; content: Array<{ type: string; text: string }> };
    error?: unknown;
  };
  expect(body.error).toBeUndefined();
  expect(body.result?.isError).not.toBe(true);
  expect(body.result?.content[0]?.type).toBe('text');
  return {
    result: JSON.parse(body.result!.content[0].text) as T,
    responseRequestId: responseRequestId!,
  };
}

describe('Admin MCP API key routes', () => {
  it('creates a key (plaintext shown once), lists it without leaking secret material, and the key authenticates at /mcp', async () => {
    // CREATE
    const createRes = await adminPost({ workspaceId: ws.workspaceId, label: 'integration-test-key' });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as {
      key: {
        id: string;
        workspaceId: string;
        workspaceName: string;
        profile: 'full' | 'client';
        label: string;
        revoked: boolean;
      };
      plaintextKeyOnceShown: string;
    };
    expect(created.plaintextKeyOnceShown).toMatch(/^mcp_/);
    expect(created.key.workspaceId).toBe(ws.workspaceId);
    expect(created.key.profile).toBe('full');
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

    // A real scoped write carries the authenticated key identity into the
    // internal activity trail, correlated to the HTTP request — never the bearer
    // token or raw tool arguments.
    const unsafeRequestId = created.plaintextKeyOnceShown;
    const { result: updateResult, responseRequestId: updateRequestId } = await callMcpTool<{
      ok: boolean;
      workspace: { id: string; onboardingEnabled?: boolean };
    }>(
      created.plaintextKeyOnceShown,
      unsafeRequestId,
      'update_workspace',
      {
        workspace_id: ws.workspaceId,
        updates: { onboarding_enabled: true },
      },
    );
    expect(updateRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(updateRequestId).not.toBe(unsafeRequestId);
    expect(updateResult.ok).toBe(true);
    expect(updateResult.workspace.id).toBe(ws.workspaceId);
    expect(updateResult.workspace.onboardingEnabled).toBe(true);

    // Exercise a client-visible mutation too. This makes the public privacy
    // assertion non-vacuous: the returned feed must retain the useful activity
    // title/action while stripping only the internal MCP caller envelope.
    const callerClientVisibleRequestId = '11111111-1111-4111-8111-111111111111';
    const contentTopic = `MCP privacy integration ${Date.now()}`;
    const { result: contentResult, responseRequestId: echoedClientVisibleRequestId } = await callMcpTool<{
      ok: boolean;
      created: boolean;
      deduped: boolean;
      request_id: string;
    }>(
      created.plaintextKeyOnceShown,
      callerClientVisibleRequestId,
      'create_content_request',
      {
        workspace_id: ws.workspaceId,
        topic: contentTopic,
        target_keyword: `mcp privacy keyword ${Date.now()}`,
        dedupe: false,
      },
    );
    expect(echoedClientVisibleRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(echoedClientVisibleRequestId).not.toBe(callerClientVisibleRequestId);
    expect(contentResult).toMatchObject({ ok: true, created: true, deduped: false });
    createdContentRequestId = contentResult.request_id;

    const activityRes = await ctx.api(`/api/activity?workspaceId=${ws.workspaceId}&limit=50`);
    expect(activityRes.status).toBe(200);
    const adminActivity = await activityRes.json() as Array<{
      metadata?: {
        action?: string;
        mcpCaller?: unknown;
      };
    }>;
    const attributedWrite = adminActivity.find(
      (entry) => entry.metadata?.action === 'mcp_workspace_updated',
    );
    expect(attributedWrite?.metadata?.mcpCaller).toEqual({
      requestId: updateRequestId,
      toolName: 'update_workspace',
      targetWorkspaceId: ws.workspaceId,
      caller: {
        kind: 'workspace_key',
        scope: ws.workspaceId,
        workspaceId: ws.workspaceId,
        keyId: created.key.id,
        keyLabel: created.key.label,
      },
    });
    expect(JSON.stringify(attributedWrite)).not.toContain(created.plaintextKeyOnceShown);

    const attributedClientVisibleWrite = adminActivity.find(
      (entry) => entry.metadata?.action === 'mcp_content_request_created',
    );
    expect(attributedClientVisibleWrite?.metadata?.mcpCaller).toEqual({
      requestId: echoedClientVisibleRequestId,
      toolName: 'create_content_request',
      targetWorkspaceId: ws.workspaceId,
      caller: {
        kind: 'workspace_key',
        scope: ws.workspaceId,
        workspaceId: ws.workspaceId,
        keyId: created.key.id,
        keyLabel: created.key.label,
      },
    });

    const clientActivityRes = await ctx.api(`/api/public/activity/${ws.workspaceId}?limit=50`);
    expect(clientActivityRes.status).toBe(200);
    const clientActivity = await clientActivityRes.json() as Array<{
      type: string;
      title: string;
      metadata?: {
        source?: string;
        requestId?: string;
        action?: string;
        mcpCaller?: unknown;
      };
    }>;
    const clientVisibleWrite = clientActivity.find(
      (entry) => entry.metadata?.action === 'mcp_content_request_created',
    );
    expect(clientVisibleWrite).toMatchObject({
      type: 'content_requested',
      title: `MCP requested topic: "${contentTopic}"`,
      metadata: {
        source: 'mcp-chat',
        requestId: createdContentRequestId,
        action: 'mcp_content_request_created',
      },
    });
    expect(clientVisibleWrite?.metadata).not.toHaveProperty('mcpCaller');
    const clientActivityJson = JSON.stringify(clientVisibleWrite);
    expect(clientActivityJson).not.toContain(created.key.id);
    expect(clientActivityJson).not.toContain(created.key.label);
    expect(clientActivityJson).not.toContain(created.plaintextKeyOnceShown);
    expect(clientActivityJson).not.toContain(callerClientVisibleRequestId);
    expect(clientActivityJson).not.toContain(echoedClientVisibleRequestId);

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

  it('defaults an omitted profile to full, persists an explicit client profile, and never lists key material', async () => {
    const legacyRes = await adminPost({ workspaceId: ws.workspaceId, label: 'legacy-profile-default' });
    expect(legacyRes.status).toBe(200);
    const legacy = await legacyRes.json() as {
      key: { id: string; profile: string };
      plaintextKeyOnceShown: string;
    };
    expect(legacy.key.profile).toBe('full');

    const clientRes = await adminPost({
      workspaceId: ws.workspaceId,
      label: 'client-profile',
      profile: 'client',
    });
    expect(clientRes.status).toBe(200);
    const client = await clientRes.json() as {
      key: { id: string; workspaceId: string; profile: string; label: string };
      plaintextKeyOnceShown: string;
    };
    expect(client.key).toMatchObject({
      workspaceId: ws.workspaceId,
      profile: 'client',
      label: 'client-profile',
    });

    const listed = await (await ctx.api('/api/admin/mcp-api-keys')).json() as {
      keys: Array<Record<string, unknown>>;
    };
    expect(listed.keys.find(key => key.id === legacy.key.id)?.profile).toBe('full');
    expect(listed.keys.find(key => key.id === client.key.id)?.profile).toBe('client');
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain(legacy.plaintextKeyOnceShown);
    expect(serialized).not.toContain(client.plaintextKeyOnceShown);
    expect(serialized).not.toContain('key_hash');
    expect(serialized).not.toContain('keyHash');
  });

  it('rejects an invalid credential profile', async () => {
    const res = await adminPost({
      workspaceId: ws.workspaceId,
      label: 'invalid-profile',
      profile: 'operator',
    });
    expect(res.status).toBe(400);
  });

  it('rejects revoking an unknown key id with 404', async () => {
    const res = await ctx.api('/api/admin/mcp-api-keys/not-a-real-id', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
