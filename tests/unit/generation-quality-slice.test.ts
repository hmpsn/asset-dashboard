import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getLatestGenerationQuality: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../../server/generation-quality-store.js', () => ({
  getLatestGenerationQuality: hoisted.getLatestGenerationQuality,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    warn: hoisted.logWarn,
  })),
}));

import { assembleGenerationQuality } from '../../server/intelligence/generation-quality-slice.js';
import { getLatestGenerationQuality } from '../../server/generation-quality-store.js';

const mockGetLatestGenerationQuality = vi.mocked(getLatestGenerationQuality);

describe('assembleGenerationQuality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the latest stored generation-quality row', async () => {
    const latest = {
      id: 42,
      workspaceId: 'ws-1',
      poolSize: 20,
      aiReturnedCount: 8,
      suppressedCount: 4,
      backfilledCount: 2,
      floorHit: false,
      createdAt: '2026-06-12T10:00:00.000Z',
    };
    mockGetLatestGenerationQuality.mockReturnValue(latest);

    await expect(assembleGenerationQuality('ws-1')).resolves.toEqual({ latest });
    expect(mockGetLatestGenerationQuality).toHaveBeenCalledWith('ws-1');
  });

  it('returns null latest when no generation-quality row exists', async () => {
    mockGetLatestGenerationQuality.mockReturnValue(null);

    await expect(assembleGenerationQuality('ws-empty')).resolves.toEqual({ latest: null });
  });

  it('degrades to null latest if the store read fails', async () => {
    mockGetLatestGenerationQuality.mockImplementation(() => {
      throw new Error('database unavailable');
    });

    await expect(assembleGenerationQuality('ws-fail')).resolves.toEqual({ latest: null });
    expect(hoisted.logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-fail' }),
      'assembleGenerationQuality: failed, degrading to empty slice',
    );
  });
});
