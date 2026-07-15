import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  hasActiveBriefRegenerateJob,
  startContentBriefRegenerateJob,
} from '../../server/content-brief-regenerate-job.js';
import {
  ContentRequestGenerationConflictError,
  ContentRequestGenerationLifecycleError,
  startContentBriefGenerationJob,
} from '../../server/content-brief-generation-job.js';
import { getBrief, listBriefs, upsertBrief } from '../../server/content-brief.js';
import { createContentRequest } from '../../server/content-requests.js';
import {
  ActiveJobResourceConflict,
  cancelJob,
  clearCompletedJobs,
  getJob,
  getJobResourceClaims,
  listJobs,
  updateJob,
} from '../../server/jobs.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { ContentBrief } from '../../shared/types/content.js';

let workspaceId = '';

function brief(id: string): ContentBrief {
  return {
    id,
    workspaceId,
    targetKeyword: `keyword ${id}`,
    secondaryKeywords: [],
    suggestedTitle: `Brief ${id}`,
    suggestedMetaDesc: 'Description',
    outline: [{ heading: 'Section', notes: 'Notes' }],
    wordCountTarget: 1_000,
    intent: 'informational',
    audience: 'Operators',
    competitorInsights: '',
    internalLinkSuggestions: [],
    createdAt: new Date().toISOString(),
  };
}

beforeAll(() => {
  workspaceId = createWorkspace(`brief job claims ${Date.now()}`).id;
  upsertBrief(workspaceId, brief('brief_claim_a'));
  upsertBrief(workspaceId, brief('brief_claim_b'));
});

afterEach(() => {
  for (const job of listJobs(workspaceId)) {
    if (job.status === 'pending' || job.status === 'running') {
      updateJob(job.id, { status: 'error', error: 'test cleanup' });
    }
  }
  clearCompletedJobs({ workspaceId });
  vi.useRealTimers();
});

afterAll(() => {
  deleteWorkspace(workspaceId);
});

describe('content brief resource-scoped jobs', () => {
  it('deduplicates one brief while allowing another brief in the same workspace', () => {
    vi.useFakeTimers();
    const first = startContentBriefRegenerateJob({
      mode: 'outline',
      workspaceId,
      briefId: 'brief_claim_a',
      expectedRevision: 0,
    });
    expect(hasActiveBriefRegenerateJob(workspaceId, 'brief_claim_a')?.id).toBe(first.jobId);
    expect(() => startContentBriefRegenerateJob({
      mode: 'regenerate',
      workspaceId,
      briefId: 'brief_claim_a',
      feedback: 'Duplicate',
      expectedRevision: 0,
    })).toThrow(ActiveJobResourceConflict);

    const independent = startContentBriefRegenerateJob({
      mode: 'outline',
      workspaceId,
      briefId: 'brief_claim_b',
      expectedRevision: 0,
    });
    expect(independent.jobId).not.toBe(first.jobId);
  });

  it('atomically rejects a stale content-request authority token', () => {
    vi.useFakeTimers();
    const request = createContentRequest(workspaceId, {
      topic: 'Authority test',
      targetKeyword: `authority keyword ${Date.now()}`,
      intent: 'informational',
      priority: 'high',
      rationale: 'Test request generation authority',
      dedupe: false,
    });

    expect(() => startContentBriefGenerationJob({
      source: 'request',
      workspaceId,
      requestId: request.id,
      expectedRequestUpdatedAt: '2020-01-01T00:00:00.000Z',
    })).toThrow(ContentRequestGenerationConflictError);
    expect(listJobs(workspaceId).some(job => job.status === 'pending')).toBe(false);
  });

  it('rejects an invalid parent lifecycle before accepting paid brief work', () => {
    vi.useFakeTimers();
    const request = createContentRequest(workspaceId, {
      topic: 'Unpaid lifecycle test',
      targetKeyword: `unpaid lifecycle keyword ${Date.now()}`,
      intent: 'informational',
      priority: 'high',
      rationale: 'Paid generation must not begin before payment',
      initialStatus: 'pending_payment',
      dedupe: false,
    });

    expect(() => startContentBriefGenerationJob({
      source: 'request',
      workspaceId,
      requestId: request.id,
      expectedRequestUpdatedAt: request.updatedAt,
    })).toThrow(ContentRequestGenerationLifecycleError);
    expect(listJobs(workspaceId).some(job => (
      job.status === 'pending' && job.message.includes(request.targetKeyword)
    ))).toBe(false);
  });

  it('drains a cancelled regeneration worker without changing the brief', async () => {
    vi.useFakeTimers();
    const before = getBrief(workspaceId, 'brief_claim_a')!;
    const started = startContentBriefRegenerateJob({
      mode: 'outline',
      workspaceId,
      briefId: before.id,
      expectedRevision: before.generationRevision,
    });

    cancelJob(started.jobId);
    await vi.runAllTimersAsync();

    expect(getJob(started.jobId)?.status).toBe('cancelled');
    const regenerationClaims = getJobResourceClaims(started.jobId);
    expect(regenerationClaims.length).toBeGreaterThan(0);
    expect(regenerationClaims.every(claim => !claim.active)).toBe(true); // every-ok: non-empty claim census asserted above
    expect(getBrief(workspaceId, before.id)?.generationRevision).toBe(before.generationRevision);
  });

  it('drains a cancelled initial-generation worker without creating a brief', async () => {
    vi.useFakeTimers();
    const targetKeyword = `cancelled target ${Date.now()}`;
    const started = startContentBriefGenerationJob({
      source: 'standalone',
      workspaceId,
      targetKeyword,
    });

    cancelJob(started.jobId);
    await vi.runAllTimersAsync();

    expect(getJob(started.jobId)?.status).toBe('cancelled');
    const generationClaims = getJobResourceClaims(started.jobId);
    expect(generationClaims.length).toBeGreaterThan(0);
    expect(generationClaims.every(claim => !claim.active)).toBe(true); // every-ok: non-empty claim census asserted above
    expect(listBriefs(workspaceId).some(item => item.targetKeyword === targetKeyword)).toBe(false);
  });
});
