/**
 * Integration tests: GET /api/cockpit/portfolio
 *
 * Exercises the registered route against real workspace-backed classifier inputs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import cockpitPortfolioRoutes from '../../server/routes/cockpit-portfolio.js';
import { createApp } from '../../server/app.js';
import type { CockpitPortfolioRollup } from '../../shared/types/cockpit-portfolio.js';
import type { Request, Response } from 'express';

let watchWorkspaceId = '';
let establishingWorkspaceId = '';

beforeAll(() => {
  watchWorkspaceId = createWorkspace('Portfolio Watch Workspace').id;
  establishingWorkspaceId = createWorkspace(
    'Portfolio Establishing Workspace',
    'portfolio-site-id',
    'Portfolio Site',
  ).id;
  updateWorkspace(establishingWorkspaceId, {
    gscPropertyUrl: 'sc-domain:portfolio.example',
    ga4PropertyId: 'properties/123456',
  });
}, 25_000);

afterAll(() => {
  if (watchWorkspaceId) deleteWorkspace(watchWorkspaceId);
  if (establishingWorkspaceId) deleteWorkspace(establishingWorkspaceId);
});

describe('GET /api/cockpit/portfolio', () => {
  it('is registered on the application router', () => {
    expect(hasRoute(createApp(), '/api/cockpit/portfolio', 'get')).toBe(true);
  });

  it('returns attention-ranked workspace classifications and verdicts', async () => {
    const res = await invokePortfolioRoute();

    expect(res.statusCode).toBe(200);
    const body = res.body as CockpitPortfolioRollup;
    const relevantRows = body.workspaces.filter(row =>
      row.workspaceId === watchWorkspaceId || row.workspaceId === establishingWorkspaceId,
    );

    expect(relevantRows.map(row => row.workspaceId)).toEqual([
      watchWorkspaceId,
      establishingWorkspaceId,
    ]);
    expect(relevantRows[0]).toEqual(expect.objectContaining({
      workspaceName: 'Portfolio Watch Workspace',
      attention: expect.objectContaining({ needsAttention: true, totalItemCount: 3 }),
      workQueue: expect.objectContaining({
        streams: { opt: 3, send: 0, money: 0, unclassified: 0 },
      }),
      verdict: expect.objectContaining({ status: 'watch' }),
    }));
    expect(relevantRows[1]).toEqual(expect.objectContaining({
      workspaceName: 'Portfolio Establishing Workspace',
      attention: expect.objectContaining({ needsAttention: true, totalItemCount: 0 }),
      workQueue: expect.objectContaining({
        streams: { opt: 0, send: 0, money: 0, unclassified: 0 },
      }),
      verdict: expect.objectContaining({ status: 'establishing' }),
    }));
  });

  it('returns honest reconciled count totals and explicit unreconciled money totals', async () => {
    const res = await invokePortfolioRoute();

    expect(res.statusCode).toBe(200);
    const body = res.body as CockpitPortfolioRollup;
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(body.totals.workspaces).toEqual({
      status: 'reconciled',
      value: body.workspaces.length,
    });
    expect(body.totals.workQueue.status).toBe('reconciled');
    expect(body.totals.verdicts.status).toBe('reconciled');
    expect(body.totals.valueAtStake).toEqual({
      status: 'not_yet_reconcilable',
      value: null,
      reason: expect.any(String),
    });
    expect(body.totals.recoveredSoFar).toEqual({
      status: 'not_yet_reconcilable',
      value: null,
      reason: expect.any(String),
    });
  });
});

function portfolioGetHandler() {
  const layer = routeStack(cockpitPortfolioRoutes)
    .find(entry => entry.route?.path === '/api/cockpit/portfolio' && entry.route.methods.get);
  const handler = layer?.route?.stack.at(-1)?.handle;
  if (!handler) throw new Error('cockpit portfolio GET handler not found');
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

async function invokePortfolioRoute() {
  const handler = portfolioGetHandler();
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
    { user: undefined } as unknown as Request,
    response as unknown as Response,
    (err?: unknown) => {
      if (err) throw err;
    },
  );

  return response;
}

interface ExpressLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
  handle?: {
    stack?: ExpressLayer[];
  };
}

function hasRoute(app: unknown, path: string, method: string): boolean {
  const stack = (app as { _router?: { stack?: ExpressLayer[] } })._router?.stack ?? [];
  const visit = (layers: ExpressLayer[]): boolean => layers.some(layer =>
    (layer.route?.path === path && layer.route.methods[method] === true)
    || visit(layer.handle?.stack ?? []),
  );
  return visit(stack);
}
