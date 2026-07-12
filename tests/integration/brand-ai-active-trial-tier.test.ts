import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const usageState = vi.hoisted(() => ({
  incrementIfAllowed: vi.fn((_workspaceId: string, _tier: string, _feature: string) => true),
  decrementUsage: vi.fn(),
}));

vi.mock('../../server/usage-tracking.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/usage-tracking.js')>(),
  incrementIfAllowed: usageState.incrementIfAllowed,
  decrementUsage: usageState.decrementUsage,
}));

vi.mock('../../server/brandscript.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/brandscript.js')>();
  const brandscript = (workspaceId: string) => ({
    id: 'bs_trial',
    workspaceId,
    name: 'Trial brandscript',
    frameworkType: 'custom',
    sections: [{
      id: 'bss_trial',
      brandscriptId: 'bs_trial',
      title: 'Problem',
      content: '',
      sortOrder: 0,
      createdAt: '2026-07-11T00:00:00.000Z',
    }],
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
  });
  return {
    ...actual,
    getBrandscript: vi.fn((workspaceId: string) => brandscript(workspaceId)),
    importBrandscript: vi.fn(async (workspaceId: string) => brandscript(workspaceId)),
    completeBrandscript: vi.fn(async (workspaceId: string) => ({
      brandscript: brandscript(workspaceId),
      generated: true,
      appliedSectionCount: 1,
    })),
  };
});

vi.mock('../../server/discovery-ingestion.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/discovery-ingestion.js')>(),
  getSourceProcessState: vi.fn(() => 'ready'),
  processSource: vi.fn(async () => []),
}));

vi.mock('../../server/brand-identity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/brand-identity.js')>();
  const deliverable = (workspaceId: string) => ({
    id: 'bid_trial',
    workspaceId,
    deliverableType: 'mission' as const,
    content: 'Trial deliverable',
    status: 'draft' as const,
    version: 1,
    tier: 'essentials' as const,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
  });
  return {
    ...actual,
    generateDeliverable: vi.fn(async (workspaceId: string) => deliverable(workspaceId)),
    refineDeliverable: vi.fn(async (workspaceId: string) => deliverable(workspaceId)),
  };
});

vi.mock('../../server/voice-calibration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/voice-calibration.js')>();
  const session = (promptType: string) => ({
    id: 'cal_trial',
    voiceProfileId: 'vp_trial',
    promptType,
    variations: [{ text: 'Trial variation' }],
    createdAt: '2026-07-11T00:00:00.000Z',
  });
  return {
    ...actual,
    generateCalibrationVariations: vi.fn(async (_workspaceId: string, promptType: string) => session(promptType)),
    refineVariation: vi.fn(async () => session('headline')),
  };
});

vi.mock('../../server/activity-log.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/activity-log.js')>(),
  addActivity: vi.fn(),
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: vi.fn(),
}));

import db from '../../server/db/index.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

let server: http.Server | undefined;
let baseUrl = '';

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
  usageState.incrementIfAllowed.mockReturnValue(true);
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  }
});

describe('Brand-family active trial usage gates', () => {
  it('passes canonical Growth entitlement to all seven AI usage gates', async () => {
    const seeded = seedWorkspace({ tier: 'free' });
    db.prepare('UPDATE workspaces SET trial_ends_at = ? WHERE id = ?')
      .run(new Date(Date.now() + 24 * 60 * 60_000).toISOString(), seeded.workspaceId);

    try {
      const calls: Array<[string, unknown]> = [
        [`/api/brandscripts/${seeded.workspaceId}/import`, { name: 'Trial import', rawText: 'Source document' }],
        [`/api/brandscripts/${seeded.workspaceId}/bs_trial/complete`, {}],
        [`/api/brand-identity/${seeded.workspaceId}/generate`, { deliverableType: 'mission' }],
        [`/api/brand-identity/${seeded.workspaceId}/bid_trial/refine`, { direction: 'Sharpen it.' }],
        [`/api/voice/${seeded.workspaceId}/calibrate`, { promptType: 'headline' }],
        [`/api/voice/${seeded.workspaceId}/calibrate/cal_trial/refine`, { variationIndex: 0, direction: 'Make it clearer.' }],
        [`/api/discovery/${seeded.workspaceId}/sources/src_trial/process`, {}],
      ];

      for (const [path, body] of calls) {
        const response = await postJson(path, body);
        expect(response.status, path).toBe(200);
      }

      expect(usageState.incrementIfAllowed).toHaveBeenCalledTimes(7);
      for (const [workspaceId, tier] of usageState.incrementIfAllowed.mock.calls) {
        expect(workspaceId).toBe(seeded.workspaceId);
        expect(tier).toBe('growth');
      }
    } finally {
      seeded.cleanup();
    }
  });
});
