/**
 * Integration tests: per-workspace feature-flag override admin routes (canary control).
 *
 * Covers:
 *   - GET  /api/admin/workspaces/:id/feature-flags → 200 with resolved value + source
 *     (source 'default' before any override).
 *   - PUT  /api/admin/workspaces/:id/feature-flags/:key { enabled: true } makes the flag
 *     resolve ON for THAT workspace only (a second workspace is unaffected; the GLOBAL
 *     resolution via GET /api/feature-flags stays at its default).
 *   - PUT  ... { enabled: null } clears the override → reverts to inherited (default).
 *   - PUT  ... { enabled: false } force-OFF beats a GLOBAL-ON override for that
 *     workspace only (a second workspace still inherits the global-ON value).
 *   - PUT  with an unknown key → 400.
 *   - GET/PUT against a non-existent workspaceId → 404 (no orphan override row;
 *     migration 114 has no FK to workspaces).
 *   - requireAdminAuth rejects an unauthenticated call (401) when APP_PASSWORD is set.
 *
 * Uses the per-workspace GET endpoint's resolved `enabled` field as the read-path
 * assertion: the server computes it via getWorkspaceFlagsWithMeta() →
 * isFeatureEnabled(flag, workspaceId), so this exercises the real resolution path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type { WorkspaceFeatureFlagMeta } from '../../shared/types/feature-flags.js';

// Probe flag must default to false: keyword-hub was retired at the Phase C cutover.
const FLAG = 'keyword-universe-full';
const RETIRED_PRODUCT_UI_FLAGS = [
  'copy-engine',
  'copy-engine-voice',
  'copy-engine-pipeline',
  'deep-diagnostics',
  'client-brand-section',
] as const;
const RETIRED_SEO_RUNTIME_FLAGS = [
  'local-seo-visibility',
  'schema-ai-element-classifier',
  'seo-generation-quality',
] as const;

// ── Main flow (auth disabled — APP_PASSWORD='' default → requireAdminAuth passes through) ──
const ctx = createEphemeralTestContext(import.meta.url, { contextName: 'main' });
const { api, authApi } = ctx;

let wsA: SeededFullWorkspace;
let wsB: SeededFullWorkspace;

async function getFlag(workspaceId: string, key: string): Promise<WorkspaceFeatureFlagMeta> {
  const res = await authApi(`/api/admin/workspaces/${workspaceId}/feature-flags`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as WorkspaceFeatureFlagMeta[];
  const flag = body.find(f => f.key === key);
  expect(flag).toBeDefined();
  return flag!;
}

beforeAll(async () => {
  await ctx.startServer();
  ctx.setAuthToken('test-token');
  wsA = seedWorkspace();
  wsB = seedWorkspace();
}, 25_000);

afterAll(async () => {
  // Best-effort: clear the override we set so we leave no orphan rows.
  try {
    await authApi(`/api/admin/workspaces/${wsA.workspaceId}/feature-flags/${FLAG}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: null }),
    });
  } catch { /* ignore */ }
  wsA?.cleanup();
  wsB?.cleanup();
  await ctx.stopServer();
});

describe('GET /api/admin/workspaces/:id/feature-flags', () => {
  it('returns every flag with a resolved value + source (default before any override)', async () => {
    const flag = await getFlag(wsA.workspaceId, FLAG);
    expect(flag.enabled).toBe(false);
    expect(flag.source).toBe('default');
    expect(flag.inheritedEnabled).toBe(false);
    expect(flag.inheritedSource).toBe('default');
    expect(typeof flag.label).toBe('string');
    expect(flag.group).toBe('Keyword Hub');
  });

  it('returns 404 for a non-existent workspace', async () => {
    const res = await authApi('/api/admin/workspaces/ws-does-not-exist-xyz/feature-flags');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Workspace not found');
  });
});

describe('PUT /api/admin/workspaces/:id/feature-flags/:key', () => {
  it('returns 400 for an unknown flag key', async () => {
    const res = await authApi(`/api/admin/workspaces/${wsA.workspaceId}/feature-flags/totally_unknown_flag_xyz`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Unknown feature flag');
  });

  it('returns 400 for retired product/UI flag keys', async () => {
    for (const key of RETIRED_PRODUCT_UI_FLAGS) {
      const res = await authApi(`/api/admin/workspaces/${wsA.workspaceId}/feature-flags/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Unknown feature flag');
    }
  });

  it('returns 400 for retired SEO/runtime flag keys', async () => {
    for (const key of RETIRED_SEO_RUNTIME_FLAGS) {
      const res = await authApi(`/api/admin/workspaces/${wsA.workspaceId}/feature-flags/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Unknown feature flag');
    }
  });

  it('returns 400 when enabled field is missing', async () => {
    const res = await authApi(`/api/admin/workspaces/${wsA.workspaceId}/feature-flags/${FLAG}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('enabled:true makes the flag resolve ON for THAT workspace only', async () => {
    const res = await authApi(`/api/admin/workspaces/${wsA.workspaceId}/feature-flags/${FLAG}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    const putBody = (await res.json()) as { success: boolean; workspaceId: string; key: string; enabled: boolean };
    expect(putBody).toMatchObject({ success: true, workspaceId: wsA.workspaceId, key: FLAG, enabled: true });

    // Workspace A: resolved ON, source 'workspace', inherited still default OFF.
    const flagA = await getFlag(wsA.workspaceId, FLAG);
    expect(flagA.enabled).toBe(true);
    expect(flagA.source).toBe('workspace');
    expect(flagA.inheritedEnabled).toBe(false);
    expect(flagA.inheritedSource).toBe('default');

    // Workspace B: UNAFFECTED — still default OFF.
    const flagB = await getFlag(wsB.workspaceId, FLAG);
    expect(flagB.enabled).toBe(false);
    expect(flagB.source).toBe('default');

    // GLOBAL resolution (no workspaceId) is unchanged — still its default.
    const globalRes = await api('/api/feature-flags');
    const globalBody = (await globalRes.json()) as Record<string, boolean>;
    expect(globalBody[FLAG]).toBe(false);
  });

  it('enabled:null clears the override → reverts to inherited (default)', async () => {
    const res = await authApi(`/api/admin/workspaces/${wsA.workspaceId}/feature-flags/${FLAG}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: null }),
    });
    expect(res.status).toBe(200);

    const flagA = await getFlag(wsA.workspaceId, FLAG);
    expect(flagA.enabled).toBe(false);
    expect(flagA.source).toBe('default');
  });

  it('enabled:false force-OFF beats a global-ON override for that workspace only', async () => {
    // Turn the GLOBAL override ON via the global PUT endpoint.
    const globalPut = await authApi(`/api/admin/feature-flags/${FLAG}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(globalPut.status).toBe(200);

    try {
      // Force the flag OFF for workspace A only.
      const res = await authApi(`/api/admin/workspaces/${wsA.workspaceId}/feature-flags/${FLAG}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(200);

      // Workspace A: force-OFF wins over global-ON. source 'workspace';
      // the inherited (global) chain it would revert to is now ON via 'db'.
      const flagA = await getFlag(wsA.workspaceId, FLAG);
      expect(flagA.enabled).toBe(false);
      expect(flagA.source).toBe('workspace');
      expect(flagA.inheritedEnabled).toBe(true);
      expect(flagA.inheritedSource).toBe('db');

      // Workspace B: no per-workspace override → inherits the global-ON value.
      const flagB = await getFlag(wsB.workspaceId, FLAG);
      expect(flagB.enabled).toBe(true);
      expect(flagB.source).toBe('db');
    } finally {
      // Restore state: clear wsA's override and the global override so we leave
      // no orphan rows and don't leak global-ON into other suites.
      await authApi(`/api/admin/workspaces/${wsA.workspaceId}/feature-flags/${FLAG}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: null }),
      });
      await authApi(`/api/admin/feature-flags/${FLAG}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: null }),
      });
    }
  });

  it('returns 404 for a non-existent workspace', async () => {
    const res = await authApi('/api/admin/workspaces/ws-does-not-exist-xyz/feature-flags/' + FLAG, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Workspace not found');
  });
});

// ── Auth rejection (APP_PASSWORD set → admin gate active) ──
const authCtx = createEphemeralTestContext(import.meta.url, {
  contextName: 'auth-gated',
  env: { APP_PASSWORD: 'secret-test-pw' },
});

describe('per-workspace feature-flag routes reject unauthenticated calls', () => {
  beforeAll(async () => {
    await authCtx.startServer();
  }, 25_000);

  afterAll(async () => {
    await authCtx.stopServer();
  });

  it('GET rejects an unauthenticated call with 401', async () => {
    const res = await authCtx.api('/api/admin/workspaces/any-ws/feature-flags');
    expect(res.status).toBe(401);
  });

  it('PUT rejects an unauthenticated call with 401', async () => {
    const res = await authCtx.api(`/api/admin/workspaces/any-ws/feature-flags/${FLAG}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(401);
  });
});
