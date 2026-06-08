import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRefreshTimingsForTesting,
  __setRefreshTimingsForTesting,
  runLocalSeoRefreshJob,
  updateLocalSeoConfiguration,
} from '../../server/local-seo.js';
import { getLocalStrategySyncStatus } from '../../server/local-strategy-sync.js';
import * as strategyModule from '../../server/keyword-strategy-generation.js';
import { setBroadcast } from '../../server/broadcast.js';
import { clearCompletedJobs, createJob, getJob, updateJob } from '../../server/jobs.js';
import { FakeSeoProvider } from '../../server/providers/fake-seo-provider.js';
import { _resetRegistryForTest, registerProvider } from '../../server/seo-data-provider.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import {
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_NEEDS_REFRESH_REASON,
  LOCAL_SEO_POSTURE,
  LOCAL_VISIBILITY_SOURCE_ENDPOINT,
  LOCAL_VISIBILITY_STATUS,
  type LocalVisibilityProviderRequest,
  type LocalVisibilityProviderResult,
} from '../../shared/types/local-seo.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';

// ── Phase 2 — Local ↔ Strategy Refresh Ordering: completion-hook chain branch ──
//
// runLocalSeoRefreshJob optionally chains a keyword-strategy regen when the
// refresh finishes — but ONLY when the admin requested it (thenRegenerateStrategy)
// AND the crawl actually produced data (result.refreshed > 0). The regen is a
// detached, tracked KEYWORD_STRATEGY job; a strategy failure must never fail the
// already-successful local-refresh job (it stays 'done'). These tests pin:
//   1. flag OFF                          → generateKeywordStrategy NOT called; job 'done'
//   2. flag ON + crawl SUCCESS           → spy called exactly once with strategy settings
//   3. flag ON + DEGRADED (refreshed>0)  → spy called (proceed)
//   4. flag ON + hard-fail (refreshed=0) → spy NOT called (abort); job still 'done'
//   5. flag ON + regen THROWS            → local-refresh job STILL 'done' (isolated)
//   6. flag ON + PROVIDER_FAILED row     → spy NOT called; local data still needs refresh
//   7. flag ON + active strategy job     → duplicate strategy job skipped

const cleanupWorkspaceIds = new Set<string>();

/** A fake provider whose getLocalVisibility outcome is configurable per test. */
type LocalVisibilityMode = 'success' | 'degraded' | 'provider_failed' | 'throw';

class ConfigurableLocalProvider extends FakeSeoProvider {
  constructor(private mode: LocalVisibilityMode) {
    super();
  }

  async getLocalVisibility(request: LocalVisibilityProviderRequest): Promise<LocalVisibilityProviderResult> {
    if (this.mode === 'throw') {
      // Throw so the refresh loop's catch increments `failed` and leaves
      // `refreshed === 0` (hard-fail / nothing crawled).
      throw new Error('synthetic provider outage');
    }
    const base = await super.getLocalVisibility(request);
    if (this.mode === 'degraded') {
      // DEGRADED is NOT PROVIDER_FAILED, so the refresh loop still counts it as
      // refreshed (> 0) — the "degraded but partial" proceed case.
      return {
        ...base,
        status: LOCAL_VISIBILITY_STATUS.DEGRADED,
        sourceEndpoint: LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP,
      };
    }
    if (this.mode === 'provider_failed') {
      return {
        ...base,
        status: LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED,
        sourceEndpoint: LOCAL_VISIBILITY_SOURCE_ENDPOINT.GOOGLE_ORGANIC_SERP,
        localPackPresent: false,
        results: [],
      };
    }
    return base;
  }
}

let strategySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __setRefreshTimingsForTesting({ itemYieldMs: 0, heapHeadroomThresholdMb: Number.MAX_SAFE_INTEGER });
  // Stub the dynamically-imported generateKeywordStrategy so we observe the call
  // without running the real (heavy, AI-backed) generator. The completion hook
  // dynamic-imports this same module record.
  strategySpy = vi.spyOn(strategyModule, 'generateKeywordStrategy').mockResolvedValue({ strategy: null } as never);
});

afterEach(() => {
  __resetRefreshTimingsForTesting();
  vi.restoreAllMocks();
  _resetRegistryForTest();
  for (const workspaceId of cleanupWorkspaceIds) {
    clearCompletedJobs({ workspaceId });
    deleteWorkspace(workspaceId);
  }
  cleanupWorkspaceIds.clear();
});

/** Flush microtasks/immediates so the detached strategy IIFE reaches the spy call. */
async function flushDetached(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

/** Seed a refresh-ready local workspace with a provider configured for the given mode. */
function seedRefreshableWorkspace(name: string, mode: LocalVisibilityMode) {
  setBroadcast(vi.fn(), vi.fn());
  const ws = createWorkspace(name);
  cleanupWorkspaceIds.add(ws.id);
  updateWorkspace(ws.id, {
    name,
    liveDomain: 'https://chain-dental.example.com',
    seoDataProvider: 'dataforseo',
    businessProfile: {
      phone: '(512) 555-0199',
      address: { street: '1 Chain St', city: 'Austin', state: 'TX', country: 'US' },
    },
  });
  updateLocalSeoConfiguration(ws.id, {
    posture: LOCAL_SEO_POSTURE.LOCAL,
    markets: [{
      label: 'Austin, TX',
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
      providerLocationCode: 1026201,
      status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
    }],
  }, true);
  addTrackedKeyword(ws.id, 'Austin Dentist', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
  registerProvider('dataforseo', new ConfigurableLocalProvider(mode));
  return ws;
}

describe('Phase 2 — chain keyword-strategy regen after local refresh', () => {
  it('(1) flag OFF → generateKeywordStrategy NOT called; local job ends done', async () => {
    const ws = seedRefreshableWorkspace('Chain flag OFF', 'success');
    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, { workspaceId: ws.id, message: 'flag off' });
    await runLocalSeoRefreshJob(job.id, ws.id, { keywords: ['Austin Dentist'] });
    await flushDetached();

    expect(getJob(job.id)?.status).toBe('done');
    expect(strategySpy).not.toHaveBeenCalled();
  });

  it('(2) flag ON + crawl SUCCESS (refreshed > 0) → spy called exactly once with strategy settings', async () => {
    const ws = seedRefreshableWorkspace('Chain success', 'success');
    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, { workspaceId: ws.id, message: 'success' });
    await runLocalSeoRefreshJob(job.id, ws.id, {
      keywords: ['Austin Dentist'],
      thenRegenerateStrategy: true,
      strategyGeneration: {
        businessContext: 'Emergency dental growth around Austin',
        seoDataMode: 'full',
        seoDataProvider: 'dataforseo',
        competitorDomains: ['competitor.example'],
        maxPages: 123,
      },
    });
    await flushDetached();

    expect(getJob(job.id)?.status).toBe('done');
    expect(strategySpy).toHaveBeenCalledTimes(1);
    expect(strategySpy).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: ws.id,
      mode: 'full',
      businessContext: 'Emergency dental growth around Austin',
      seoDataMode: 'full',
      seoDataProvider: 'dataforseo',
      competitorDomains: ['competitor.example'],
      competitorDomainsProvided: true,
      maxPages: 123,
    }));
  });

  it('(3) flag ON + DEGRADED but refreshed > 0 → spy called (proceed)', async () => {
    const ws = seedRefreshableWorkspace('Chain degraded', 'degraded');
    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, { workspaceId: ws.id, message: 'degraded' });
    await runLocalSeoRefreshJob(job.id, ws.id, { keywords: ['Austin Dentist'], thenRegenerateStrategy: true });
    await flushDetached();

    expect(getJob(job.id)?.status).toBe('done');
    expect(strategySpy).toHaveBeenCalledTimes(1);
  });

  it('(4) flag ON + hard-fail (refreshed === 0) → spy NOT called (abort); job still done', async () => {
    const ws = seedRefreshableWorkspace('Chain hard-fail', 'throw');
    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, { workspaceId: ws.id, message: 'hard fail' });
    await runLocalSeoRefreshJob(job.id, ws.id, { keywords: ['Austin Dentist'], thenRegenerateStrategy: true });
    await flushDetached();

    const finalJob = getJob(job.id);
    expect(finalJob?.status).toBe('done');
    expect((finalJob?.result as { refreshed: number }).refreshed).toBe(0);
    expect(strategySpy).not.toHaveBeenCalled();
  });

  it('(5) flag ON + generateKeywordStrategy throws → local-refresh job STILL done (isolated)', async () => {
    const ws = seedRefreshableWorkspace('Chain regen throws', 'success');
    strategySpy.mockRejectedValueOnce(new Error('boom: keyword strategy regen failed'));
    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, { workspaceId: ws.id, message: 'regen throws' });
    await runLocalSeoRefreshJob(job.id, ws.id, { keywords: ['Austin Dentist'], thenRegenerateStrategy: true });
    await flushDetached();

    expect(strategySpy).toHaveBeenCalledTimes(1);
    const finalJob = getJob(job.id);
    // The strategy regen threw, but its own try/catch swallows it — the local
    // refresh job is already successful and stays 'done' with no error.
    expect(finalJob?.status).toBe('done');
    expect(finalJob?.error).toBeUndefined();
  });

  it('(6) flag ON + provider-failed snapshot → spy NOT called and local data still needs refresh', async () => {
    const ws = seedRefreshableWorkspace('Chain provider failed', 'provider_failed');
    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, { workspaceId: ws.id, message: 'provider failed' });
    await runLocalSeoRefreshJob(job.id, ws.id, { keywords: ['Austin Dentist'], thenRegenerateStrategy: true });
    await flushDetached();

    const finalJob = getJob(job.id);
    expect(finalJob?.status).toBe('done');
    expect((finalJob?.result as { refreshed: number; failed: number }).refreshed).toBe(0);
    expect((finalJob?.result as { refreshed: number; failed: number }).failed).toBe(1);
    expect(strategySpy).not.toHaveBeenCalled();

    const localSync = getLocalStrategySyncStatus(ws.id);
    expect(localSync.localNeedsRefresh).toBe(true);
    expect(localSync.localNeedsRefreshReason).toBe(LOCAL_NEEDS_REFRESH_REASON.MISSING);
    expect(localSync.lastLocalRefreshAt).toBeNull();
  });

  it('(7) flag ON + active keyword strategy job → duplicate strategy regen is skipped', async () => {
    const ws = seedRefreshableWorkspace('Chain active strategy guard', 'success');
    const activeStrategyJob = createJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, { workspaceId: ws.id, message: 'already running' });
    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, { workspaceId: ws.id, message: 'active guard' });
    await runLocalSeoRefreshJob(job.id, ws.id, { keywords: ['Austin Dentist'], thenRegenerateStrategy: true });
    await flushDetached();

    expect(getJob(job.id)?.status).toBe('done');
    expect(strategySpy).not.toHaveBeenCalled();
    expect(getJob(activeStrategyJob.id)?.status).toBe('pending');
    updateJob(activeStrategyJob.id, { status: 'done' });
  });
});
