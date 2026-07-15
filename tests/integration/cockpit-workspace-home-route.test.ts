import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { clearAdminMoneyFrame, saveAdminMoneyFrame } from '../../server/money-frame-store.js';
import workspaceHomeRoutes from '../../server/routes/workspace-home.js';
import type { AdminMoneyFrame } from '../../shared/types/outcome-tracking.js';
import type { CockpitVerdict } from '../../shared/types/cockpit.js';
import type { WorkQueueClassification } from '../../shared/types/work-queue.js';
import type { Request, Response } from 'express';

let workspaceId = '';

const moneyFrame: AdminMoneyFrame = {
  valueAtStake: 12345,
  recoveredSoFar: 678,
  provenance: 'measured_action',
  precomputedAt: '2026-07-07T12:00:00.000Z',
};

beforeAll(async () => {
  workspaceId = createWorkspace('Cockpit Workspace Home Read Path').id;
  saveAdminMoneyFrame(workspaceId, moneyFrame);
});

afterAll(async () => {
  if (workspaceId) {
    clearAdminMoneyFrame(workspaceId);
    deleteWorkspace(workspaceId);
  }
});

describe('workspace-home Cockpit additive fields', () => {
  it('serializes server-derived verdict, shared work queue, and admin money frame', async () => {
    const res = await invokeWorkspaceHomeRoute(workspaceId, { days: '28' });

    expect(res.statusCode).toBe(200);
    const body = res.body as {
      cockpitVerdict?: CockpitVerdict;
      workQueue?: WorkQueueClassification;
      moneyFrame?: AdminMoneyFrame | null;
    };

    expect(body.cockpitVerdict).toEqual(expect.objectContaining({
      status: expect.any(String),
      headline: expect.any(String),
      narrative: expect.any(String),
      generatedAt: expect.any(String),
    }));
    expect(body.cockpitVerdict?.evidence.length).toBeGreaterThan(0);
    expect(body.workQueue).toEqual(expect.objectContaining({
      streams: expect.objectContaining({
        opt: expect.any(Number),
        send: expect.any(Number),
        money: expect.any(Number),
        unclassified: expect.any(Number),
      }),
      items: expect.any(Array),
    }));
    expect(body.moneyFrame).toEqual(moneyFrame);
  });
});

function workspaceHomeGetHandler() {
  const layer = routeStack(workspaceHomeRoutes)
    .find((entry) => entry.route?.path === '/api/workspace-home/:id' && entry.route.methods.get);
  const handler = layer?.route?.stack.at(-1)?.handle;
  if (!handler) throw new Error('workspace-home GET handler not found');
  return handler as (req: Request, res: Response, next: (err?: unknown) => void) => unknown | Promise<unknown>;
}

function routeStack(router: unknown): Array<{
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
}> {
  return (router as { stack?: Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: unknown }>;
    };
  }> }).stack ?? [];
}

async function invokeWorkspaceHomeRoute(workspaceId: string, query: Record<string, string>) {
  const handler = workspaceHomeGetHandler();
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  await handler(
    { params: { id: workspaceId }, query } as unknown as Request,
    response as unknown as Response,
    (err?: unknown) => {
      if (err) throw err;
    },
  );

  return response;
}
