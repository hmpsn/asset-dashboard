import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { saveAdminMoneyFrame } from '../../server/money-frame-store.js';
import { theIssueAdminRouter } from '../../server/routes/the-issue-admin.js';

let wsReady: string;
let wsEmpty: string;
let wsOff: string;
const cleanups: Array<() => void> = [];

interface RouteResponse {
  status: number;
  body: unknown;
}

function getAdminMoneyFrame(workspaceId: string): Promise<RouteResponse> {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    let settled = false;
    const finish = (status: number, body?: unknown) => {
      if (settled) return;
      settled = true;
      resolve({ status, body });
    };
    const req = {
      method: 'GET',
      url: `/api/workspaces/${workspaceId}/admin-money-frame`,
      originalUrl: `/api/workspaces/${workspaceId}/admin-money-frame`,
      headers: {},
      params: {},
      query: {},
    } as Request;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        finish(statusCode, payload);
        return this;
      },
      sendStatus(code: number) {
        finish(code);
        return this;
      },
      setHeader() {
        return this;
      },
      end(payload?: unknown) {
        finish(statusCode, payload);
        return this;
      },
    } as unknown as Response;

    theIssueAdminRouter.handle(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }
      finish(404);
    });
  });
}

beforeAll(() => {
  delete process.env.APP_PASSWORD;
  const ready = seedWorkspace();
  wsReady = ready.workspaceId;
  cleanups.push(ready.cleanup);

  const empty = seedWorkspace();
  wsEmpty = empty.workspaceId;
  cleanups.push(empty.cleanup);

  const off = seedWorkspace();
  wsOff = off.workspaceId;
  cleanups.push(off.cleanup);

  setWorkspaceFlagOverride('ui-rebuild-shell', wsReady, true);
  setWorkspaceFlagOverride('ui-rebuild-shell', wsEmpty, true);
  setWorkspaceFlagOverride('ui-rebuild-shell', wsOff, false);

  saveAdminMoneyFrame(wsReady, {
    valueAtStake: 2500,
    recoveredSoFar: 725.5,
    provenance: 'actual_reconciled',
    precomputedAt: '2026-07-06T12:00:00.000Z',
  });
  saveAdminMoneyFrame(wsOff, {
    valueAtStake: 9999,
    recoveredSoFar: 9999,
    provenance: 'estimate_ga4',
    precomputedAt: '2026-07-06T12:00:00.000Z',
  });
});

afterAll(() => {
  for (const id of [wsReady, wsEmpty, wsOff]) {
    setWorkspaceFlagOverride('ui-rebuild-shell', id, null);
  }
  for (const cleanup of cleanups) cleanup();
});

describe('GET /api/workspaces/:id/admin-money-frame', () => {
  it('returns the persisted AdminMoneyFrame without computing on the GET path', async () => {
    const res = await getAdminMoneyFrame(wsReady);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      valueAtStake: 2500,
      recoveredSoFar: 725.5,
      provenance: 'actual_reconciled',
      precomputedAt: '2026-07-06T12:00:00.000Z',
    });
  });

  it('returns 404 when the workspace has not been precomputed yet', async () => {
    const res = await getAdminMoneyFrame(wsEmpty);

    expect(res.status).toBe(404);
  });

  it('returns 404 when the UI rebuild flag is off even if a cached frame exists', async () => {
    const res = await getAdminMoneyFrame(wsOff);

    expect(res.status).toBe(404);
  });
});
