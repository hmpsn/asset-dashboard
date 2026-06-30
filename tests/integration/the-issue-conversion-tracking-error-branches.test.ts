/**
 * The Issue (Client) P1a — conversion-tracking ROUTE ERROR BRANCHES (GET /webflow-forms).
 *
 * Companion to the-issue-conversion-tracking.test.ts (which covers the happy paths over the real
 * child-process boundary + the public-payload PII boundary). The two error branches of the forms-picker
 * endpoint can only be exercised IN-PROCESS:
 *
 *   - 400 "Link a Webflow site first" — a workspace with no webflowSiteId.
 *   - 502 "Could not load Webflow forms" — the FM-2 honest-degradation catch when listWebflowForms
 *     throws. This requires a `vi.spyOn` on the webflow-forms module, which only affects the in-process
 *     module instance — a child-process spawned server can't be spied, so the happy-path file can't
 *     reach this branch (with no real token, listWebflowForms returns [] → 200, never throws).
 *
 * In-process server pattern (http.createServer(createApp()) on port 0, APP_PASSWORD unset), mirror of
 * competitor-alerts-route.test.ts. requireWorkspaceAccess passes through for HMAC (no JWT user) when
 * APP_PASSWORD is unset, so the unauthenticated fetch reaches the handler.
 */
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import * as webflowForms from '../../server/webflow-forms.js';

let baseUrl = '';
let server: http.Server | undefined;
// Flag ON, NO webflow site → exercises the 400 branch.
let wsNoSite = '';
// Flag ON, site linked → exercises the 502 branch (via a spy that throws).
let wsWithSite = '';

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  server = http.createServer(createApp());
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  wsNoSite = createWorkspace('Conversion Tracking No-Site WS').id;
  wsWithSite = createWorkspace('Conversion Tracking With-Site WS').id;
  // Link a Webflow site on the second workspace so the route reaches the listWebflowForms call.
  updateWorkspace(wsWithSite, { webflowSiteId: 'site-error-branch' });

  for (const id of [wsNoSite, wsWithSite]) {
    setWorkspaceFlagOverride('the-issue-client-measured-capture', id, true);
  }
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const id of [wsNoSite, wsWithSite]) {
    setWorkspaceFlagOverride('the-issue-client-measured-capture', id, null);
    deleteWorkspace(id);
  }
  if (server) await new Promise<void>((resolve, reject) => server!.close(err => (err ? reject(err) : resolve())));
});

describe('GET /api/workspaces/:id/webflow-forms — error branches', () => {
  it('400s with "Link a Webflow site first" when the workspace has no Webflow site', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces/${wsNoSite}/webflow-forms`);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/Link a Webflow site first/i);
  });

  it('502s (FM-2 honest degradation) with an empty forms array when listWebflowForms throws', async () => {
    vi.spyOn(webflowForms, 'listWebflowForms').mockRejectedValueOnce(new Error('Webflow 500'));
    const res = await fetch(`${baseUrl}/api/workspaces/${wsWithSite}/webflow-forms`);
    expect(res.status).toBe(502);
    const json = await res.json() as { error: string; forms: unknown[] };
    expect(json.error).toMatch(/Could not load Webflow forms/i);
    // Degrades to an empty picker, never a 500 throw.
    expect(Array.isArray(json.forms)).toBe(true);
    expect(json.forms).toHaveLength(0);
  });
});
