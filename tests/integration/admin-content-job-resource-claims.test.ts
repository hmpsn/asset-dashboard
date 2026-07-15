import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  clearCompletedJobs,
  createResourceScopedJob,
  listJobs,
  updateJob,
} from '../../server/jobs.js';
import { addEntry, createBlueprint } from '../../server/page-strategy.js';
import { getBrief, upsertBrief } from '../../server/content-brief.js';
import { getContentRequest } from '../../server/content-requests.js';
import {
  BACKGROUND_JOB_TYPES,
  JOB_RESOURCE_TYPES,
} from '../../shared/types/background-jobs.js';
import { seedContentData, type SeededContent } from '../fixtures/content-seed.js';

vi.mock('../../server/broadcast.js', () => ({
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  setBroadcast: vi.fn(),
}));

vi.mock('../../server/content-posts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/content-posts.js')>();
  return {
    ...actual,
    runContentPostGenerationJob: vi.fn(),
  };
});

vi.mock('../../server/copy-entry-generation-job.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/copy-entry-generation-job.js')>();
  return {
    ...actual,
    runCopyEntryGenerationJob: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../server/copy-batch-jobs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/copy-batch-jobs.js')>();
  return {
    ...actual,
    runCopyBatchGenerationJob: vi.fn().mockResolvedValue(undefined),
  };
});

const nativeFetch = globalThis.fetch;
let server: http.Server | undefined;
let baseUrl = '';
let seeded: SeededContent;

async function postJob(type: string, params: Record<string, unknown>): Promise<Response> {
  return nativeFetch(`${baseUrl}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, params }),
  });
}

function releaseWorkspaceJobs(workspaceId: string): void {
  for (const job of listJobs(workspaceId)) {
    if (job.status === 'pending' || job.status === 'running') {
      updateJob(job.id, { status: 'error', error: 'test cleanup' });
    }
  }
  clearCompletedJobs({ workspaceId });
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(() => {
  seeded = seedContentData();
});

afterEach(() => {
  releaseWorkspaceJobs(seeded.workspaceId);
  seeded.cleanup();
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('POST /api/jobs content authority contracts', () => {
  it('requires the brief revision and request updated-at authority tokens', async () => {
    const postResponse = await postJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, {
      workspaceId: seeded.workspaceId,
      briefId: seeded.briefId,
    });
    expect(postResponse.status).toBe(400);
    await expect(postResponse.json()).resolves.toEqual({ error: 'expectedBriefRevision required' });

    const briefResponse = await postJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, {
      workspaceId: seeded.workspaceId,
      requestId: seeded.requestId,
    });
    expect(briefResponse.status).toBe(400);
    await expect(briefResponse.json()).resolves.toEqual({ error: 'expectedRequestUpdatedAt required' });
  });

  it('returns deterministic revision conflicts without accepting a job', async () => {
    const brief = getBrief(seeded.workspaceId, seeded.briefId);
    if (!brief) throw new Error('Seeded brief missing');

    const postResponse = await postJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, {
      workspaceId: seeded.workspaceId,
      briefId: seeded.briefId,
      expectedBriefRevision: brief.generationRevision + 1,
    });
    expect(postResponse.status).toBe(409);
    await expect(postResponse.json()).resolves.toMatchObject({
      code: 'generation_revision_conflict',
    });

    const request = getContentRequest(seeded.workspaceId, seeded.requestId);
    if (!request) throw new Error('Seeded content request missing');
    const requestResponse = await postJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, {
      workspaceId: seeded.workspaceId,
      requestId: request.id,
      expectedRequestUpdatedAt: `${request.updatedAt}-stale`,
    });
    const requestBody = await requestResponse.json();
    expect({ status: requestResponse.status, body: requestBody }).toMatchObject({
      status: 409,
      body: { code: 'content_request_generation_conflict' },
    });

    expect(listJobs(seeded.workspaceId)).toHaveLength(0);
  });

  it('maps invalid request lifecycle authority to a deterministic conflict without accepting a job', async () => {
    const request = getContentRequest(seeded.workspaceId, seeded.requestId);
    if (!request) throw new Error('Seeded content request missing');

    const response = await postJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, {
      workspaceId: seeded.workspaceId,
      requestId: request.id,
      expectedRequestUpdatedAt: request.updatedAt,
    });
    await expect(response.json()).resolves.toMatchObject({
      code: 'content_request_generation_lifecycle_invalid',
      status: 'approved',
    });
    expect(response.status).toBe(409);
    expect(listJobs(seeded.workspaceId)).toHaveLength(0);
  });

  it('deduplicates post generation by brief while allowing another brief', async () => {
    const firstBrief = getBrief(seeded.workspaceId, seeded.briefId);
    if (!firstBrief) throw new Error('Seeded brief missing');
    const secondBriefId = `${seeded.briefId}-second`;
    upsertBrief(seeded.workspaceId, {
      ...firstBrief,
      id: secondBriefId,
      createdAt: new Date().toISOString(),
    });
    const secondBrief = getBrief(seeded.workspaceId, secondBriefId);
    if (!secondBrief) throw new Error('Second brief missing');

    const owner = createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, {
      workspaceId: seeded.workspaceId,
      resources: [{
        resourceType: JOB_RESOURCE_TYPES.CONTENT_POST_FOR_BRIEF,
        resourceId: firstBrief.id,
      }],
    });

    const conflictResponse = await postJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, {
      workspaceId: seeded.workspaceId,
      briefId: firstBrief.id,
      expectedBriefRevision: firstBrief.generationRevision,
    });
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      code: 'active_job_resource_conflict',
      jobId: owner.job.id,
    });

    const independentResponse = await postJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, {
      workspaceId: seeded.workspaceId,
      briefId: secondBrief.id,
      expectedBriefRevision: secondBrief.generationRevision,
    });
    expect(independentResponse.status).toBe(200);
    await expect(independentResponse.json()).resolves.toMatchObject({
      jobId: expect.any(String),
      postId: expect.any(String),
    });
  });
});

describe('POST /api/jobs copy resource contracts', () => {
  it('deduplicates a copy entry while allowing a disjoint entry', async () => {
    const blueprint = createBlueprint({ workspaceId: seeded.workspaceId, name: 'Entry claims' });
    const claimedEntry = addEntry(seeded.workspaceId, blueprint.id, {
      name: 'Claimed page',
      pageType: 'landing',
    });
    const independentEntry = addEntry(seeded.workspaceId, blueprint.id, {
      name: 'Independent page',
      pageType: 'landing',
    });
    if (!claimedEntry || !independentEntry) throw new Error('Failed to seed blueprint entries');

    const owner = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: seeded.workspaceId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.COPY_ENTRY, resourceId: claimedEntry.id }],
    });

    const conflictResponse = await postJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: seeded.workspaceId,
      blueprintId: blueprint.id,
      entryId: claimedEntry.id,
    });
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      code: 'active_job_resource_conflict',
      jobId: owner.job.id,
    });

    const independentResponse = await postJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: seeded.workspaceId,
      blueprintId: blueprint.id,
      entryId: independentEntry.id,
    });
    expect(independentResponse.status).toBe(200);
    await expect(independentResponse.json()).resolves.toEqual({ jobId: expect.any(String) });
  });

  it('rejects duplicate batch IDs and atomically rejects overlap while allowing a disjoint batch', async () => {
    const blueprint = createBlueprint({ workspaceId: seeded.workspaceId, name: 'Batch claims' });
    const entries = ['Claimed', 'Free one', 'Free two'].map(name =>
      addEntry(seeded.workspaceId, blueprint.id, { name, pageType: 'landing' }),
    );
    if (entries.some(entry => !entry)) throw new Error('Failed to seed blueprint entries');
    const [claimedEntry, freeEntryOne, freeEntryTwo] = entries;
    if (!claimedEntry || !freeEntryOne || !freeEntryTwo) throw new Error('Failed to seed blueprint entries');

    const duplicateResponse = await postJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, {
      workspaceId: seeded.workspaceId,
      blueprintId: blueprint.id,
      entryIds: [freeEntryOne.id, freeEntryOne.id],
    });
    expect(duplicateResponse.status).toBe(400);
    await expect(duplicateResponse.json()).resolves.toEqual({ error: 'entryIds must be unique' });

    const owner = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
      workspaceId: seeded.workspaceId,
      resources: [{ resourceType: JOB_RESOURCE_TYPES.COPY_ENTRY, resourceId: claimedEntry.id }],
    });
    const conflictResponse = await postJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, {
      workspaceId: seeded.workspaceId,
      blueprintId: blueprint.id,
      entryIds: [claimedEntry.id, freeEntryOne.id],
    });
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      code: 'active_job_resource_conflict',
      jobId: owner.job.id,
    });

    const independentResponse = await postJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, {
      workspaceId: seeded.workspaceId,
      blueprintId: blueprint.id,
      entryIds: [freeEntryOne.id, freeEntryTwo.id],
    });
    expect(independentResponse.status).toBe(200);
    await expect(independentResponse.json()).resolves.toMatchObject({ jobId: expect.any(String) });
  });
});
