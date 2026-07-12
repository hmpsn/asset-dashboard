import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StrategyPov, StrategyPovResponse } from '../../../shared/types/strategy-pov';
import { queryKeys } from '../../../src/lib/queryKeys';
import { WS_EVENTS } from '../../../src/lib/wsEvents';

const mocks = vi.hoisted(() => ({
  edit: vi.fn(),
  generate: vi.fn(),
  get: vi.fn(),
  regenerate: vi.fn(),
  workspaceHandlers: {} as Record<string, () => void>,
}));

vi.mock('../../../src/api/strategyPov', () => ({
  strategyPovApi: {
    edit: (...args: unknown[]) => mocks.edit(...args),
    generate: (...args: unknown[]) => mocks.generate(...args),
    get: (...args: unknown[]) => mocks.get(...args),
    regenerate: (...args: unknown[]) => mocks.regenerate(...args),
  },
}));

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (_workspaceId: string | undefined, handlers: Record<string, () => void>) => {
    mocks.workspaceHandlers = handlers;
  },
}));

import * as strategyPovHook from '../../../src/hooks/admin/useStrategyPov';

const workspaceId = 'ws-pov-monotonic';

function pov(
  version: number,
  situation = `Situation v${version}`,
  overrides: Partial<StrategyPov> = {},
): StrategyPov {
  return {
    situation,
    leadMoveRecId: 'rec-1',
    leadSentence: `Lead v${version}`,
    wins: [],
    flags: [],
    version,
    generatedAt: `2026-07-${String(version).padStart(2, '0')}T00:00:00.000Z`,
    editedAt: version > 1 ? `2026-07-${String(version).padStart(2, '0')}T00:05:00.000Z` : null,
    ...overrides,
  };
}

function response(version: number, refreshAvailable = false): StrategyPovResponse {
  return { pov: pov(version), refreshAvailable };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useStrategyPov monotonic response authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceHandlers = {};
    mocks.get.mockResolvedValue({ pov: null, refreshAvailable: false });
  });

  it('merges by POV version: stale null/older responses cannot erase newer data while equal versions update freshness', () => {
    const merge = (strategyPovHook as unknown as {
      mergeStrategyPovResponse?: (
        current: StrategyPovResponse | undefined,
        incoming: StrategyPovResponse,
      ) => StrategyPovResponse;
    }).mergeStrategyPovResponse;

    expect(merge).toBeTypeOf('function');
    const current = response(4, false);
    expect(merge?.(current, { pov: null, refreshAvailable: false })).toEqual(current);
    expect(merge?.(current, response(3, true))).toEqual(current);
    expect(merge?.(current, response(4, true))).toEqual(response(4, true));
    expect(merge?.(current, response(5, false))).toEqual(response(5, false));

    const newerSameVersion: StrategyPovResponse = {
      pov: pov(4, 'Regenerated prose', {
        generatedAt: '2026-07-11T12:00:00.000Z',
        editedAt: null,
      }),
      refreshAvailable: false,
    };
    const olderSameVersion: StrategyPovResponse = {
      pov: pov(4, 'Old prose', {
        generatedAt: '2026-07-11T11:00:00.000Z',
        editedAt: null,
      }),
      refreshAvailable: true,
    };
    expect(merge?.(newerSameVersion, olderSameVersion)).toEqual(newerSameVersion);
    expect(merge?.(newerSameVersion, { ...newerSameVersion, refreshAvailable: true }))
      .toEqual({ ...newerSameVersion, refreshAvailable: true });
  });

  it('does not let a slow GET overwrite a newer cache version', async () => {
    const gate = deferred<StrategyPovResponse>();
    mocks.get.mockReturnValueOnce(gate.promise);
    const client = createClient();
    const key = queryKeys.admin.strategyPov(workspaceId);
    const { result } = renderHook(
      () => strategyPovHook.useStrategyPov(workspaceId, true),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    act(() => client.setQueryData<StrategyPovResponse>(key, response(3, true)));
    await act(async () => gate.resolve(response(1, false)));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pov?.version).toBe(3);
    expect(result.current.refreshAvailable).toBe(true);
  });

  it('keeps a newer server response when an older optimistic edit rolls back', async () => {
    const failure = deferred<StrategyPovResponse>();
    mocks.edit.mockReturnValueOnce(failure.promise);
    const client = createClient();
    const key = queryKeys.admin.strategyPov(workspaceId);
    client.setQueryData<StrategyPovResponse>(key, response(2, false));
    const { result } = renderHook(
      () => strategyPovHook.useStrategyPov(workspaceId, true),
      { wrapper: wrapper(client) },
    );

    act(() => result.current.edit({ situation: 'Optimistic edit' }));
    await waitFor(() => expect(result.current.editPending).toBe(true));
    act(() => client.setQueryData<StrategyPovResponse>(key, response(4, true)));
    await act(async () => failure.reject(new Error('edit failed')));
    await waitFor(() => expect(result.current.editPending).toBe(false));

    expect(result.current.pov?.version).toBe(4);
    expect(result.current.pov?.situation).toBe('Situation v4');
    expect(result.current.refreshAvailable).toBe(true);
  });

  it('restores the previous response when the failed edit still owns the optimistic snapshot', async () => {
    mocks.edit.mockRejectedValueOnce(new Error('edit failed'));
    const client = createClient();
    const key = queryKeys.admin.strategyPov(workspaceId);
    client.setQueryData<StrategyPovResponse>(key, response(2, false));
    const { result } = renderHook(
      () => strategyPovHook.useStrategyPov(workspaceId, true),
      { wrapper: wrapper(client) },
    );

    act(() => result.current.edit({ situation: 'Optimistic edit' }));
    await waitFor(() => expect(result.current.editPending).toBe(false));

    expect(result.current.pov).toEqual(pov(2));
    expect(result.current.refreshAvailable).toBe(false);
  });

  it('serializes overlapping edits so A failing and B succeeding finishes on B server authority', async () => {
    const first = deferred<StrategyPovResponse>();
    const second = deferred<StrategyPovResponse>();
    mocks.edit
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const client = createClient();
    const key = queryKeys.admin.strategyPov(workspaceId);
    client.setQueryData<StrategyPovResponse>(key, response(2, false));
    const { result } = renderHook(
      () => strategyPovHook.useStrategyPov(workspaceId, true),
      { wrapper: wrapper(client) },
    );

    act(() => result.current.edit({ situation: 'Edit A optimism' }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    expect(result.current.pov?.version).toBe(2);
    expect(result.current.pov?.situation).toBe('Edit A optimism');
    act(() => result.current.edit({ leadSentence: 'Edit B optimism' }));
    await act(async () => Promise.resolve());
    const callsBeforeASettled = mocks.edit.mock.calls.length;
    expect(result.current.pov?.version).toBe(2);

    await act(async () => first.reject(new Error('Edit A failed')));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(2));
    const serverB = {
      pov: pov(3, 'Situation v2', {
        leadSentence: 'Edit B from server',
        editedAt: '2026-07-11T13:00:00.000Z',
      }),
      refreshAvailable: false,
    } satisfies StrategyPovResponse;
    await act(async () => second.resolve(serverB));
    await waitFor(() => expect(result.current.editPending).toBe(false));

    expect(callsBeforeASettled).toBe(1);
    expect(result.current.pov).toEqual(serverB.pov);
    expect(result.current.pov?.version).toBe(3);
    expect(result.current.pov?.situation).toBe('Situation v2');
    expect(result.current.pov?.leadSentence).toBe('Edit B from server');
  });

  it('restores the original confirmed response when overlapping edits A and B both fail', async () => {
    const first = deferred<StrategyPovResponse>();
    const second = deferred<StrategyPovResponse>();
    mocks.edit
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const client = createClient();
    const key = queryKeys.admin.strategyPov(workspaceId);
    const confirmed = response(2, false);
    client.setQueryData<StrategyPovResponse>(key, confirmed);
    const { result } = renderHook(
      () => strategyPovHook.useStrategyPov(workspaceId, true),
      { wrapper: wrapper(client) },
    );

    act(() => result.current.edit({ situation: 'Edit A optimism' }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    act(() => result.current.edit({ leadSentence: 'Edit B optimism' }));
    await waitFor(() => expect(result.current.pov?.leadSentence).toBe('Edit B optimism'));

    await act(async () => first.reject(new Error('Edit A failed')));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(2));
    await act(async () => second.reject(new Error('Edit B failed')));
    await waitFor(() => expect(result.current.editPending).toBe(false));

    expect(client.getQueryData<StrategyPovResponse>(key)).toEqual(confirmed);
    expect(result.current.pov).toEqual(confirmed.pov);
  });

  it('keeps A server authority when overlapping edit A succeeds and queued edit B fails', async () => {
    const first = deferred<StrategyPovResponse>();
    const second = deferred<StrategyPovResponse>();
    mocks.edit
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const client = createClient();
    const key = queryKeys.admin.strategyPov(workspaceId);
    client.setQueryData<StrategyPovResponse>(key, response(2, false));
    const { result } = renderHook(
      () => strategyPovHook.useStrategyPov(workspaceId, true),
      { wrapper: wrapper(client) },
    );

    act(() => result.current.edit({ situation: 'Edit A optimism' }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    act(() => result.current.edit({ leadSentence: 'Edit B optimism' }));
    await waitFor(() => expect(result.current.pov?.leadSentence).toBe('Edit B optimism'));

    const serverA = {
      pov: pov(3, 'Edit A from server', {
        editedAt: '2026-07-11T14:00:00.000Z',
      }),
      refreshAvailable: false,
    } satisfies StrategyPovResponse;
    await act(async () => first.resolve(serverA));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(2));
    await act(async () => second.reject(new Error('Edit B failed')));
    await waitFor(() => expect(result.current.editPending).toBe(false));

    expect(client.getQueryData<StrategyPovResponse>(key)).toEqual(serverA);
    expect(result.current.pov).toEqual(serverA.pov);
  });

  it('keeps a newer same-version regeneration when a slow pre-regeneration GET resolves last', async () => {
    const slowGet = deferred<StrategyPovResponse>();
    mocks.get.mockReturnValueOnce(slowGet.promise);
    const oldResponse = {
      pov: pov(2, 'Old generated prose', {
        generatedAt: '2026-07-11T11:00:00.000Z',
        editedAt: null,
      }),
      refreshAvailable: true,
    } satisfies StrategyPovResponse;
    const regeneratedResponse = {
      pov: pov(2, 'New regenerated prose', {
        generatedAt: '2026-07-11T12:00:00.000Z',
        editedAt: null,
      }),
      refreshAvailable: false,
    } satisfies StrategyPovResponse;
    mocks.regenerate.mockResolvedValueOnce(regeneratedResponse);
    const client = createClient();
    const key = queryKeys.admin.strategyPov(workspaceId);
    const { result } = renderHook(
      () => strategyPovHook.useStrategyPov(workspaceId, true),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    act(() => client.setQueryData<StrategyPovResponse>(key, oldResponse));
    act(() => result.current.regenerate());
    await waitFor(() => expect(mocks.regenerate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pov?.situation).toBe('New regenerated prose'));
    await act(async () => slowGet.resolve(oldResponse));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pov).toEqual(regeneratedResponse.pov);
    expect(result.current.refreshAvailable).toBe(false);
  });

  it('exposes regenerate failures through generateError', async () => {
    const error = new Error('Regeneration unavailable');
    mocks.regenerate.mockRejectedValueOnce(error);
    const client = createClient();
    client.setQueryData<StrategyPovResponse>(queryKeys.admin.strategyPov(workspaceId), response(2));
    const { result } = renderHook(
      () => strategyPovHook.useStrategyPov(workspaceId, true),
      { wrapper: wrapper(client) },
    );

    act(() => result.current.regenerate());
    await waitFor(() => expect(mocks.regenerate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isGenerating).toBe(false));

    expect(result.current.generateError).toBe(error);
  });

  it('does not let an older mutation success overwrite a newer cache version', async () => {
    mocks.generate.mockResolvedValueOnce(response(2, false));
    const client = createClient();
    const key = queryKeys.admin.strategyPov(workspaceId);
    client.setQueryData<StrategyPovResponse>(key, response(4, true));
    const { result } = renderHook(
      () => strategyPovHook.useStrategyPov(workspaceId, true),
      { wrapper: wrapper(client) },
    );

    act(() => result.current.generate());
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isGenerating).toBe(false));

    expect(result.current.pov?.version).toBe(4);
    expect(result.current.refreshAvailable).toBe(true);
  });

  it('invalidates the exact POV key for generated and intelligence-cache events', async () => {
    const client = createClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderHook(
      () => strategyPovHook.useStrategyPov(workspaceId, true),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(mocks.workspaceHandlers[WS_EVENTS.STRATEGY_POV_GENERATED]).toBeTypeOf('function'));

    expect(mocks.workspaceHandlers[WS_EVENTS.INTELLIGENCE_CACHE_UPDATED]).toBeTypeOf('function');
    act(() => {
      mocks.workspaceHandlers[WS_EVENTS.STRATEGY_POV_GENERATED]?.();
      mocks.workspaceHandlers[WS_EVENTS.INTELLIGENCE_CACHE_UPDATED]?.();
    });

    const expected = { queryKey: queryKeys.admin.strategyPov(workspaceId) };
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenNthCalledWith(1, expected);
    expect(invalidate).toHaveBeenNthCalledWith(2, expected);
  });
});
