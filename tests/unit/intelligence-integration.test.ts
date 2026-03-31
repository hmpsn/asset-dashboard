// tests/unit/intelligence-integration.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { seedIntelligenceTestData } from '../fixtures/intelligence-seed.js';
import { buildWorkspaceIntelligence, invalidateIntelligenceCache } from '../../server/workspace-intelligence.js';

describe('Intelligence Layer Integration', () => {
  const { workspaceId, cleanup } = seedIntelligenceTestData();

  afterAll(() => {
    cleanup();
  });

  it('assembles insights slice from seeded data', async () => {
    invalidateIntelligenceCache(workspaceId);
    const result = await buildWorkspaceIntelligence(workspaceId, { slices: ['insights'] });

    expect(result.version).toBe(1);
    expect(result.workspaceId).toBe(workspaceId);
    expect(result.insights).toBeDefined();
    expect(result.insights!.all.length).toBeGreaterThan(0);
    expect(result.insights!.all.length).toBeLessThanOrEqual(100);

    // Verify severity counts add up
    const { bySeverity } = result.insights!;
    const totalBySeverity = bySeverity.critical + bySeverity.warning + bySeverity.opportunity + bySeverity.positive;
    expect(totalBySeverity).toBe(result.insights!.all.length);
  });

  it('returns partial data when one slice fails', async () => {
    invalidateIntelligenceCache(workspaceId);
    // seoContext will fail for a test workspace (no real Webflow connection)
    // insights should still work
    const result = await buildWorkspaceIntelligence(workspaceId, {
      slices: ['seoContext', 'insights'],
    });

    // One slice may fail, the other should succeed
    expect(result.insights).toBeDefined();
    // seoContext may or may not be defined depending on workspace config
    // The key assertion: no exception thrown
  });

  it('caches results across calls', async () => {
    invalidateIntelligenceCache(workspaceId);
    const result1 = await buildWorkspaceIntelligence(workspaceId, { slices: ['insights'] });
    const result2 = await buildWorkspaceIntelligence(workspaceId, { slices: ['insights'] });

    // Same assembledAt timestamp means cache hit
    expect(result1.assembledAt).toBe(result2.assembledAt);
  });

  it('returns fresh data after cache invalidation', async () => {
    const result1 = await buildWorkspaceIntelligence(workspaceId, { slices: ['insights'] });
    invalidateIntelligenceCache(workspaceId);
    // Small delay to ensure assembledAt timestamps differ across re-assembly
    await new Promise(r => setTimeout(r, 2));
    const result2 = await buildWorkspaceIntelligence(workspaceId, { slices: ['insights'] });

    // Different assembledAt means fresh assembly
    expect(result1.assembledAt).not.toBe(result2.assembledAt);
  });
});
