import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

const aiState = vi.hoisted(() => ({
  callAI: vi.fn(),
}));

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
  throwOnBroadcast: false,
}));

const cacheState = vi.hoisted(() => ({
  invalidateIntelligenceCache: vi.fn(),
  throwOnInvalidate: false,
}));

const activityState = vi.hoisted(() => ({
  attempts: 0,
  throwOnAdd: false,
}));

vi.mock('../../server/ai.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/ai.js')>(),
  callAI: aiState.callAI,
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn().mockResolvedValue({}),
  formatForPrompt: vi.fn().mockReturnValue(''),
  buildIntelPrompt: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
    if (broadcastState.throwOnBroadcast) throw new Error('broadcast unavailable');
  }),
}));

vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: (...args: unknown[]) => {
    cacheState.invalidateIntelligenceCache(...args);
    if (cacheState.throwOnInvalidate) throw new Error('cache invalidation unavailable');
  },
}));

vi.mock('../../server/activity-log.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/activity-log.js')>();
  return {
    ...actual,
    addActivity: (...args: Parameters<typeof actual.addActivity>) => {
      activityState.attempts += 1;
      if (activityState.throwOnAdd) throw new Error('activity log unavailable');
      return actual.addActivity(...args);
    },
  };
});

import db from '../../server/db/index.js';
import { listActivity } from '../../server/activity-log.js';
import { addSource, listExtractionsBySource, listSources } from '../../server/discovery-ingestion.js';
import { getUsageCount } from '../../server/usage-tracking.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let server: http.Server | undefined;
let baseUrl = '';
const cleanups: Array<() => void> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function workspace(tier: 'free' | 'growth' = 'growth'): string {
  const seeded = seedWorkspace({ tier });
  cleanups.push(seeded.cleanup);
  return seeded.workspaceId;
}

function processPath(workspaceId: string, sourceId: string): string {
  return `/api/discovery/${workspaceId}/sources/${sourceId}/process`;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function activityCount(workspaceId: string): number {
  return listActivity(workspaceId, 100)
    .filter(activity => activity.type === 'discovery_processed').length;
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 40_000);

beforeEach(() => {
  vi.clearAllMocks();
  broadcastState.calls = [];
  broadcastState.throwOnBroadcast = false;
  cacheState.throwOnInvalidate = false;
  activityState.attempts = 0;
  activityState.throwOnAdd = false;
});

afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close(error => error ? reject(error) : resolve());
    });
  }
});

describe('Discovery ingestion process route hardening', () => {
  it('blocks free-tier processing before the AI call without consuming usage', async () => {
    const workspaceId = workspace('free');
    const source = addSource(workspaceId, 'free.txt', 'brand_doc', 'Free tier source');

    const response = await postJson(processPath(workspaceId, source.id), {});

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: 'usage_limit' });
    expect(aiState.callAI).not.toHaveBeenCalled();
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(0);
    expect(activityCount(workspaceId)).toBe(0);
    expect(broadcastState.calls).toEqual([]);
    expect(cacheState.invalidateIntelligenceCache).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown workspace before reserving usage or calling AI', async () => {
    const missingWorkspaceId = `missing-${randomUUID()}`;
    const response = await postJson(processPath(missingWorkspaceId, 'src_missing'), {});

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Workspace not found' });
    expect(aiState.callAI).not.toHaveBeenCalled();
    expect(getUsageCount(missingWorkspaceId, 'brandscript_generations')).toBe(0);
  });

  it('refunds the reserved usage slot and emits no success effects when AI fails', async () => {
    const workspaceId = workspace();
    const source = addSource(workspaceId, 'failure.txt', 'brand_doc', 'Provider failure source');
    aiState.callAI.mockRejectedValueOnce(new Error('provider secret / internal stack'));

    const response = await postJson(processPath(workspaceId, source.id), {});

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Processing failed' });
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(0);
    expect(listSources(workspaceId).find(item => item.id === source.id)?.processedAt).toBeUndefined();
    expect(activityCount(workspaceId)).toBe(0);
    expect(broadcastState.calls).toEqual([]);
    expect(cacheState.invalidateIntelligenceCache).not.toHaveBeenCalled();
  });

  it('keeps a durably processed source successful and charged when post-commit effects fail', async () => {
    const workspaceId = workspace();
    const source = addSource(workspaceId, 'durable.txt', 'brand_doc', 'Durable processing source');
    const usageBefore = getUsageCount(workspaceId, 'brandscript_generations');
    aiState.callAI.mockResolvedValueOnce({ text: JSON.stringify({ extractions: [] }) });
    activityState.throwOnAdd = true;
    broadcastState.throwOnBroadcast = true;
    cacheState.throwOnInvalidate = true;

    const response = await postJson(processPath(workspaceId, source.id), {});

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ extractions: [] });
    expect(listSources(workspaceId).find(item => item.id === source.id)?.processedAt).toBeTruthy();
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(usageBefore + 1);
    expect(activityState.attempts).toBe(1);
    expect(broadcastState.calls).toHaveLength(1);
    expect(cacheState.invalidateIntelligenceCache).toHaveBeenCalledWith(workspaceId);
  });

  it('returns one fixed 409 for an overlapping request and makes only one AI call', async () => {
    const workspaceId = workspace();
    const source = addSource(workspaceId, 'concurrent.txt', 'transcript', 'Concurrent source');
    const enteredAI = deferred<void>();
    const releaseAI = deferred<void>();
    aiState.callAI.mockImplementationOnce(async () => {
      enteredAI.resolve();
      await releaseAI.promise;
      return { text: JSON.stringify({ extractions: [] }) };
    });

    const firstResponse = postJson(processPath(workspaceId, source.id), {});
    await enteredAI.promise;
    const overlapping = await postJson(processPath(workspaceId, source.id), {});
    releaseAI.resolve();
    const completed = await firstResponse;

    expect(overlapping.status).toBe(409);
    await expect(overlapping.json()).resolves.toEqual({
      error: 'This discovery source is already being processed. Try again after the current run finishes.',
      code: 'source_processing_in_progress',
    });
    expect(aiState.callAI).toHaveBeenCalledTimes(1);
    expect(completed.status).toBe(200);
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(1);
    expect(activityCount(workspaceId)).toBe(1);
    expect(broadcastState.calls.filter(call => call.event === WS_EVENTS.DISCOVERY_UPDATED)).toHaveLength(1);
    expect(cacheState.invalidateIntelligenceCache).toHaveBeenCalledTimes(1);
  });

  it('maps a post-AI version race to a fixed 409 and refunds usage without writes', async () => {
    const workspaceId = workspace();
    const source = addSource(workspaceId, 'race.txt', 'brand_doc', 'Cross-process race source');
    const enteredAI = deferred<void>();
    const releaseAI = deferred<void>();
    aiState.callAI.mockImplementationOnce(async () => {
      enteredAI.resolve();
      await releaseAI.promise;
      return {
        text: JSON.stringify({
          extractions: [{
            extraction_type: 'story_element',
            category: 'origin_story',
            content: 'Losing extraction',
          }],
        }),
      };
    });

    const responsePromise = postJson(processPath(workspaceId, source.id), {});
    await enteredAI.promise;
    db.prepare('UPDATE discovery_sources SET processed_at = ? WHERE id = ? AND workspace_id = ?')
      .run('2031-04-05T06:07:08.000Z', source.id, workspaceId);
    releaseAI.resolve();
    const response = await responsePromise;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'This discovery source changed while it was processing. Reload it before trying again.',
      code: 'source_processing_conflict',
    });
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(0);
    expect(listExtractionsBySource(workspaceId, source.id)).toEqual([]);
    expect(activityCount(workspaceId)).toBe(0);
    expect(broadcastState.calls).toEqual([]);
    expect(cacheState.invalidateIntelligenceCache).not.toHaveBeenCalled();
  });

  it('applies the three-request aiLimiter cap to the process route', async () => {
    const workspaceId = workspace();
    const source = addSource(workspaceId, 'limiter.txt', 'brand_doc', 'Limiter source');
    aiState.callAI.mockResolvedValue({ text: JSON.stringify({ extractions: [] }) });
    const path = processPath(workspaceId, source.id);

    const first = await postJson(path, {});
    const second = await postJson(path, {});
    const third = await postJson(path, {});
    const blocked = await postJson(path, {});

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      error: 'This discovery source has already been processed. Use force to replace its existing extractions.',
      code: 'source_already_processed',
    });
    expect(third.status).toBe(409);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('3');
    await expect(blocked.json()).resolves.toEqual({
      error: 'Too many requests. Please try again later.',
    });
    expect(aiState.callAI).toHaveBeenCalledTimes(1);
    expect(getUsageCount(workspaceId, 'brandscript_generations')).toBe(1);
    expect(activityCount(workspaceId)).toBe(1);
  });
});
