import type { Request, RequestHandler, Response, Router } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/auth.js', () => ({
  requireWorkspaceAccess: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock('../../server/domains/brand/generation/service.js', () => ({
  startBrandGeneration: vi.fn(),
  getBrandGeneration: vi.fn(),
  resumeBrandGeneration: vi.fn(),
  reviseBrandGenerationItem: vi.fn(),
}));

import {
  BrandGenerationBudgetExceededError,
  BrandGenerationCursorError,
  BrandGenerationIdempotencyConflictError,
  BrandGenerationNotFoundError,
  BrandGenerationPreconditionError,
  BrandGenerationRevisionConflictError,
} from '../../server/domains/brand/generation/errors.js';
import {
  createBrandGenerationRouter,
  type BrandGenerationRouteDependencies,
} from '../../server/routes/brand-generation.js';

const WORKSPACE_ID = 'ws_brand_routes';
const RUN_ID = 'brand_run_routes_1';
const ITEM_ID = 'brand_item_routes_1';
const SIGNED_ITEM_CURSOR = `${Buffer.from(JSON.stringify({
  schemaVersion: 1,
  workspaceId: WORKSPACE_ID,
  runId: RUN_ID,
  runRevision: 3,
})).toString('base64url')}.${Buffer.from('cursor-hmac-signature').toString('base64url')}`;

function commandResult(existing = false) {
  return {
    runId: RUN_ID,
    runRevision: 0,
    jobId: 'job_brand_routes_1',
    selectionCount: 1,
    estimate: {
      providerCalls: 3,
      inputTokens: 12_000,
      outputTokens: 2_000,
      estimatedCostMicros: 500_000,
      maxConcurrency: 1,
    },
    dashboardUrl: `/ws/${WORKSPACE_ID}/brand`,
    existing,
  };
}

function dependencies() {
  const startBrandGeneration = vi.fn<BrandGenerationRouteDependencies['startBrandGeneration']>(
    () => commandResult(false),
  );
  const getBrandGeneration = vi.fn<BrandGenerationRouteDependencies['getBrandGeneration']>(
    () => ({
      run: {
        id: RUN_ID,
        workspaceId: WORKSPACE_ID,
        createdBy: {
          actorType: 'mcp',
          actorId: 'must-not-escape-key-id',
          actorLabel: 'must-not-escape-key-label',
        },
        idempotencyKey: 'must-not-escape-idempotency',
        mcpExecutionContext: { requestId: 'must-not-escape-request' },
      },
      itemPage: { items: [], nextCursor: null, hasMore: false },
    } as never),
  );
  const resumeBrandGeneration = vi.fn<BrandGenerationRouteDependencies['resumeBrandGeneration']>(
    () => commandResult(false),
  );
  const reviseBrandGenerationItem = vi.fn<
    BrandGenerationRouteDependencies['reviseBrandGenerationItem']
  >(() => commandResult(false));
  const value: BrandGenerationRouteDependencies = {
    startBrandGeneration,
    getBrandGeneration,
    resumeBrandGeneration,
    reviseBrandGenerationItem,
  };
  return {
    value,
    startBrandGeneration,
    getBrandGeneration,
    resumeBrandGeneration,
    reviseBrandGenerationItem,
  };
}

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function finalHandler(router: Router, path: string, method: string): RequestHandler {
  const layers = (router as unknown as { stack: RouteLayer[] }).stack;
  const route = layers.find(layer => (
    layer.route?.path === path && layer.route.methods[method] === true
  ))?.route;
  const handler = route?.stack.at(-1)?.handle;
  if (!handler) throw new Error(`Missing ${method.toUpperCase()} ${path}`);
  return handler;
}

async function invokeFinal(
  router: Router,
  path: string,
  method: string,
  request: Partial<Request>,
) {
  const state: { status: number; body: unknown } = { status: 200, body: undefined };
  const response = {
    status: vi.fn((status: number) => {
      state.status = status;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      state.body = body;
      return response;
    }),
  } as unknown as Response;
  await finalHandler(router, path, method)(
    request as Request,
    response,
    vi.fn(),
  );
  return state;
}

describe('brand generation HTTP routes', () => {
  it('derives operator attribution server-side and returns 202/200 for new/replayed starts', async () => {
    const deps = dependencies();
    deps.startBrandGeneration
      .mockReturnValueOnce(commandResult(false))
      .mockReturnValueOnce(commandResult(true));
    const router = createBrandGenerationRouter(deps.value);
    const request = {
      params: { workspaceId: WORKSPACE_ID },
      body: {
        intakeRevisionId: 'intake_revision_1',
        expectedIntakeRevision: 2,
        expectedIntakeFingerprint: 'a'.repeat(64),
        selection: { kind: 'atomic', target: 'mission' },
        expectedVoiceVersion: 4,
        expectedVoiceFingerprint: 'b'.repeat(64),
        budget: {
          maxProviderCalls: 6,
          maxInputTokens: 50_000,
          maxOutputTokens: 8_000,
          maxEstimatedCostMicros: 2_000_000,
          maxConcurrency: 2,
        },
        idempotencyKey: 'route-brand-start-1',
        createdBy: { actorType: 'mcp', actorId: 'caller-controlled' },
      },
      user: {
        id: 'operator_1',
        name: 'Brand strategist',
      },
    } as unknown as Partial<Request>;

    const created = await invokeFinal(
      router,
      '/api/brand-generation/:workspaceId/runs',
      'post',
      request,
    );
    const replayed = await invokeFinal(
      router,
      '/api/brand-generation/:workspaceId/runs',
      'post',
      request,
    );

    expect(created.status).toBe(202);
    expect(replayed.status).toBe(200);
    expect(deps.startBrandGeneration).toHaveBeenNthCalledWith(1, expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      createdBy: {
        actorType: 'operator',
        actorId: 'operator_1',
        actorLabel: 'Brand strategist',
      },
      mcpExecutionContext: null,
    }));
    expect(JSON.stringify(deps.startBrandGeneration.mock.calls[0]?.[0]))
      .not.toContain('caller-controlled');
  });

  it('uses admin-HMAC attribution for a non-JWT operator request', async () => {
    const deps = dependencies();
    const router = createBrandGenerationRouter(deps.value);
    await invokeFinal(
      router,
      '/api/brand-generation/:workspaceId/runs/:runId/resume',
      'post',
      {
        params: { workspaceId: WORKSPACE_ID, runId: RUN_ID },
        body: {
          expectedRunRevision: 3,
          expectedVoiceVersion: 4,
          expectedVoiceFingerprint: 'b'.repeat(64),
          idempotencyKey: 'route-brand-resume-1',
        },
      },
    );

    expect(deps.resumeBrandGeneration).toHaveBeenCalledWith(expect.objectContaining({
      resumedBy: {
        actorType: 'operator',
        actorId: 'admin-hmac',
        actorLabel: 'Admin operator',
      },
      mcpExecutionContext: null,
    }));
  });

  it('forwards bounded pagination and never exposes persisted/MCP identities', async () => {
    const deps = dependencies();
    const router = createBrandGenerationRouter(deps.value);
    const result = await invokeFinal(
      router,
      '/api/brand-generation/:workspaceId/runs/:runId',
      'get',
      {
        params: { workspaceId: WORKSPACE_ID, runId: RUN_ID },
        query: { itemCursor: SIGNED_ITEM_CURSOR, itemLimit: '25' },
      },
    );

    expect(deps.getBrandGeneration).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      cursor: SIGNED_ITEM_CURSOR,
      limit: 25,
    });
    expect(result.body).toMatchObject({
      run: { id: RUN_ID, createdBy: { actorType: 'mcp' } },
      itemPage: { items: [], hasMore: false },
    });
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain('idempotency');
    expect(serialized).not.toContain('must-not-escape');
    expect(serialized).not.toContain('mcpExecutionContext');
  });

  it('rejects a cursor with extra signature separators before the read service', async () => {
    const deps = dependencies();
    const result = await invokeFinal(
      createBrandGenerationRouter(deps.value),
      '/api/brand-generation/:workspaceId/runs/:runId',
      'get',
      {
        params: { workspaceId: WORKSPACE_ID, runId: RUN_ID },
        query: { itemCursor: `${SIGNED_ITEM_CURSOR}.unexpected` },
      },
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid brand-generation query' });
    expect(deps.getBrandGeneration).not.toHaveBeenCalled();
  });

  it.each([
    [new BrandGenerationCursorError(), 400, 'brand_generation_invalid_cursor'],
    [new BrandGenerationNotFoundError('run'), 404, 'brand_generation_not_found'],
    [new BrandGenerationRevisionConflictError('run', 2, 3), 409, 'brand_generation_revision_conflict'],
    [new BrandGenerationIdempotencyConflictError('start'), 409, 'brand_generation_idempotency_conflict'],
    [new BrandGenerationBudgetExceededError('providerCalls', 7, 6), 422, 'brand_generation_budget_exceeded'],
    [new BrandGenerationPreconditionError('voice_not_finalized', 'private detail'), 422, 'brand_generation_precondition_failed'],
  ] as const)('maps a typed domain error to safe HTTP %s', async (error, status, code) => {
    const deps = dependencies();
    deps.getBrandGeneration.mockImplementation(() => { throw error; });
    const result = await invokeFinal(
      createBrandGenerationRouter(deps.value),
      '/api/brand-generation/:workspaceId/runs/:runId',
      'get',
      {
        params: { workspaceId: WORKSPACE_ID, runId: RUN_ID },
        query: {},
      },
    );

    expect(result.status).toBe(status);
    expect(result.body).toMatchObject({ code });
    expect(JSON.stringify(result.body)).not.toContain('private detail');
  });

  it('forwards exact item/deliverable revisions for a review-directed revision', async () => {
    const deps = dependencies();
    await invokeFinal(
      createBrandGenerationRouter(deps.value),
      '/api/brand-generation/:workspaceId/runs/:runId/items/:itemId/revisions',
      'post',
      {
        params: { workspaceId: WORKSPACE_ID, runId: RUN_ID, itemId: ITEM_ID },
        body: {
          expectedRunRevision: 4,
          expectedItemRevision: 2,
          deliverableId: 'deliverable_1',
          expectedDeliverableVersion: 3,
          direction: 'Use the reviewer direction without inventing new evidence.',
          idempotencyKey: 'route-brand-revision-1',
        },
      },
    );

    expect(deps.reviseBrandGenerationItem).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      itemId: ITEM_ID,
      expectedRunRevision: 4,
      expectedItemRevision: 2,
      deliverableId: 'deliverable_1',
      expectedDeliverableVersion: 3,
      requestedBy: expect.objectContaining({ actorId: 'admin-hmac' }),
      mcpExecutionContext: null,
    }));
  });
});
