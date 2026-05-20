import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateLocalBusinessMatch, runLocalSeoRefreshJob, updateLocalSeoConfiguration } from '../../server/local-seo.js';
import { setBroadcast } from '../../server/broadcast.js';
import { clearCompletedJobs, createJob, getJob } from '../../server/jobs.js';
import { FakeSeoProvider } from '../../server/providers/fake-seo-provider.js';
import { _resetRegistryForTest, registerProvider } from '../../server/seo-data-provider.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { LOCAL_SEO_MARKET_STATUS, LOCAL_SEO_POSTURE } from '../../shared/types/local-seo.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import type { Workspace } from '../../shared/types/workspace.js';

const workspace: Workspace = {
  id: 'ws-local-match',
  name: 'Local Dental',
  liveDomain: 'https://local-dental.example.com',
  folder: 'local-dental',
  createdAt: '2026-05-20T00:00:00.000Z',
  businessProfile: {
    phone: '(512) 555-0123',
    address: {
      street: '123 Congress Ave',
      city: 'Austin',
      state: 'TX',
      country: 'US',
    },
  },
};

const cleanupWorkspaceIds = new Set<string>();

afterEach(() => {
  _resetRegistryForTest();
  for (const workspaceId of cleanupWorkspaceIds) {
    clearCompletedJobs({ workspaceId });
    deleteWorkspace(workspaceId);
  }
  cleanupWorkspaceIds.clear();
});

describe('local SEO business match confidence', () => {
  it('does not treat city-only competitor addresses as business matches', () => {
    const match = evaluateLocalBusinessMatch(workspace, [{
      title: 'Competitor Dental',
      rank: 1,
      domain: 'competitor.example.com',
      address: '999 Congress Ave, Austin, TX',
    }]);

    expect(match).toEqual(expect.objectContaining({
      confidence: 'not_found',
      found: false,
    }));
  });

  it('uses domain plus identity evidence for verified matches', () => {
    const match = evaluateLocalBusinessMatch(workspace, [{
      title: 'Local Dental',
      rank: 2,
      domain: 'local-dental.example.com',
      phone: '(512) 555-0123',
      address: '123 Congress Ave, Austin, TX',
      cid: 'abc',
    }]);

    expect(match).toEqual(expect.objectContaining({
      confidence: 'verified',
      found: true,
      rank: 2,
    }));
  });

  it('does not verify domain-only matches just because the provider returned a cid', () => {
    const match = evaluateLocalBusinessMatch(workspace, [{
      title: 'Unrelated Directory Listing',
      rank: 2,
      domain: 'local-dental.example.com',
      cid: 'provider-place-id',
    }]);

    expect(match).toEqual(expect.objectContaining({
      confidence: 'strong_match',
      found: true,
      rank: 2,
    }));
  });

  it('keeps name-only matches as possible, not verified', () => {
    const match = evaluateLocalBusinessMatch(workspace, [{
      title: 'Local Dental',
      rank: 3,
      domain: 'directory.example.com',
    }]);

    expect(match).toEqual(expect.objectContaining({
      confidence: 'possible_match',
      found: true,
      rank: 3,
    }));
  });
});

describe('local SEO provider selection', () => {
  it('does not fall back to DataForSEO when the workspace selected SEMRush for local visibility', async () => {
    setBroadcast(vi.fn(), vi.fn());
    const ws = createWorkspace('Local SEO Provider Strictness Test');
    cleanupWorkspaceIds.add(ws.id);
    updateWorkspace(ws.id, {
      liveDomain: 'https://local-dental.example.com',
      seoDataProvider: 'semrush',
      businessProfile: {
        address: {
          street: '123 Congress Ave',
          city: 'Austin',
          state: 'TX',
          country: 'US',
        },
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
    registerProvider('dataforseo', new FakeSeoProvider());

    const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
      workspaceId: ws.id,
      message: 'Testing provider strictness...',
    });

    await runLocalSeoRefreshJob(job.id, ws.id);

    expect(getJob(job.id)).toEqual(expect.objectContaining({
      status: 'error',
      error: 'No configured local visibility provider',
    }));
  });
});
