// tests/unit/workspace-intelligence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all subsystem dependencies
vi.mock('../../server/seo-context.js', () => ({
  buildSeoContext: vi.fn(),
  getRawBrandVoice: vi.fn(() => ''),
  getRawKnowledge: vi.fn(() => ''),
}));
vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(),
}));
vi.mock('../../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn(),
}));
vi.mock('../../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn().mockReturnValue([]),
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  getActionsByPage: vi.fn(),
  getOutcomesForAction: vi.fn(),
}));
vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));
vi.mock('../../server/intelligence-cache.js', () => {
  class MockLRUCache {
    get = vi.fn().mockReturnValue(null);
    set = vi.fn();
    deleteByPrefix = vi.fn().mockReturnValue(0);
    stats = vi.fn().mockReturnValue({ entries: 0, maxEntries: 200 });
  }
  return {
    LRUCache: MockLRUCache,
    singleFlight: vi.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
  };
});

import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';
import { buildSeoContext } from '../../server/seo-context.js';
import { getInsights } from '../../server/analytics-insights-store.js';
import { getWorkspaceLearnings } from '../../server/workspace-learnings.js';

const mockBuildSeoContext = vi.mocked(buildSeoContext);
const mockGetInsights = vi.mocked(getInsights);
const mockGetLearnings = vi.mocked(getWorkspaceLearnings);

describe('buildWorkspaceIntelligence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildSeoContext.mockReturnValue({
      strategy: undefined,
      brandVoiceBlock: 'Test brand voice',
      businessContext: 'Test context',
      personasBlock: '',
      knowledgeBlock: '',
      keywordBlock: '',
      fullContext: '',
    } as any);
    mockGetInsights.mockReturnValue([]);
    mockGetLearnings.mockReturnValue(null);
  });

  it('returns a valid WorkspaceIntelligence object with version and timestamp', async () => {
    const result = await buildWorkspaceIntelligence('ws-1');
    expect(result.version).toBe(1);
    expect(result.workspaceId).toBe('ws-1');
    expect(result.assembledAt).toBeDefined();
    expect(new Date(result.assembledAt).getTime()).not.toBeNaN();
  });

  it('assembles only requested slices', async () => {
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext'] });
    expect(result.seoContext).toBeDefined();
    expect(result.insights).toBeUndefined();
    expect(result.learnings).toBeUndefined();
  });

  it('assembles all slices when none specified', async () => {
    const result = await buildWorkspaceIntelligence('ws-1');
    expect(result.seoContext).toBeDefined();
    expect(result.insights).toBeDefined();
  });

  it('gracefully handles subsystem failure — returns partial data', async () => {
    mockBuildSeoContext.mockImplementation(() => { throw new Error('SEO context failed'); });
    mockGetInsights.mockReturnValue([
      { id: '1', insightType: 'content_decay', severity: 'warning', impactScore: 5 },
    ] as any);

    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext', 'insights'] });
    expect(result.seoContext).toBeUndefined();
    expect(result.insights).toBeDefined();
    expect(result.insights!.all).toHaveLength(1);
  });

  it('caps insights at 100 by impact score', async () => {
    const manyInsights = Array.from({ length: 150 }, (_, i) => ({
      id: `insight-${i}`,
      insightType: 'content_decay',
      severity: 'warning',
      impactScore: i,
    }));
    mockGetInsights.mockReturnValue(manyInsights as any);

    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['insights'] });
    expect(result.insights!.all.length).toBeLessThanOrEqual(100);
    expect(result.insights!.all[0].impactScore).toBe(149);
  });
});

describe('assembleSeoContext — voice profile authority on intelligence path', () => {
  /**
   * Regression test for the "intelligence path is blind to voice profiles" bug.
   *
   * Before the fix: `SeoContextSlice.brandVoice` held the raw legacy `workspace.brandVoice`
   * via `getRawBrandVoice()`. 12 caller sites across content-brief, internal-links,
   * aeo-page-review, webflow-seo, rewrite-chat, jobs, and admin-chat-context formatted
   * it via `formatBrandVoiceForPrompt(seo?.brandVoice)` — completely bypassing the voice
   * profile authority logic in `buildSeoContext`. Result: for non-calibrated workspaces
   * the entire voice profile feature (DNA, samples, guardrails) was invisible to the AI
   * on those code paths; for calibrated workspaces the legacy block contradicted Layer 2.
   *
   * Fix: `assembleSeoContext` now also sets `effectiveBrandVoiceBlock` from
   * `ctx.brandVoiceBlock`, which is the already-computed authority-applied block from
   * `buildSeoContext`. Callers migrate from `formatBrandVoiceForPrompt(seo?.brandVoice)`
   * to `seo?.effectiveBrandVoiceBlock ?? ''`.
   *
   * This test asserts the wiring at the assembler layer. The authority logic itself is
   * covered by tests/unit/seo-context-voice-profile.test.ts against a real DB.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInsights.mockReturnValue([]);
    mockGetLearnings.mockReturnValue(null);
  });

  it('copies buildSeoContext.brandVoiceBlock into seoContext.effectiveBrandVoiceBlock', async () => {
    const AUTHORITY_BLOCK = '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nSentinel legacy voice for wiring check';
    mockBuildSeoContext.mockReturnValue({
      strategy: undefined,
      brandVoiceBlock: AUTHORITY_BLOCK,
      businessContext: '',
      personasBlock: '',
      knowledgeBlock: '',
      keywordBlock: '',
      fullContext: '',
    } as any);

    const result = await buildWorkspaceIntelligence('ws-voice-1', { slices: ['seoContext'] });

    expect(result.seoContext).toBeDefined();
    expect(result.seoContext!.effectiveBrandVoiceBlock).toBe(AUTHORITY_BLOCK);
  });

  it('returns empty effectiveBrandVoiceBlock when buildSeoContext returns empty (no legacy, no profile)', async () => {
    // Silent-drop regression guard: when the whole voice system is empty the field must
    // still exist as a string — not undefined, not missing — so caller sites can safely
    // do `seo?.effectiveBrandVoiceBlock ?? ''` without TypeScript gymnastics.
    mockBuildSeoContext.mockReturnValue({
      strategy: undefined,
      brandVoiceBlock: '',
      businessContext: '',
      personasBlock: '',
      knowledgeBlock: '',
      keywordBlock: '',
      fullContext: '',
    } as any);

    const result = await buildWorkspaceIntelligence('ws-voice-2', { slices: ['seoContext'] });

    expect(result.seoContext).toBeDefined();
    expect(typeof result.seoContext!.effectiveBrandVoiceBlock).toBe('string');
    expect(result.seoContext!.effectiveBrandVoiceBlock).toBe('');
  });

  it('passes buildSeoContext.brandVoiceBlock through unchanged (no re-formatting at assembler layer)', async () => {
    // This test verifies the assembler's passthrough contract only — it does NOT
    // exercise the calibration authority logic itself. buildSeoContext is fully
    // mocked here, so whatever it returns (calibrated or legacy format) must reach
    // the slice byte-for-byte. Real calibration authority is covered end-to-end in
    // tests/unit/seo-context-voice-profile.test.ts against a real DB.
    const CALIBRATED_BLOCK = '\n\nBRAND VOICE REFERENCE (samples):\n- Sentinel calibrated sample';
    mockBuildSeoContext.mockReturnValue({
      strategy: undefined,
      brandVoiceBlock: CALIBRATED_BLOCK,
      businessContext: '',
      personasBlock: '',
      knowledgeBlock: '',
      keywordBlock: '',
      fullContext: '',
    } as any);

    const result = await buildWorkspaceIntelligence('ws-voice-3', { slices: ['seoContext'] });

    expect(result.seoContext!.effectiveBrandVoiceBlock).toBe(CALIBRATED_BLOCK);
    // And the raw brandVoice field (which used to be the only field) is still separate
    // — callers that need the pre-authority text can still reach it.
    expect(result.seoContext!.brandVoice).toBe('');
  });
});
