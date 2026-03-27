/**
 * Unit tests for Phase 5 — llms.txt auto-regeneration + freshness tracking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Freshness tracking tests ──

describe('llms-txt freshness tracking', () => {
  let setLastGenerated: (workspaceId: string) => void;
  let getLastGenerated: (workspaceId: string) => string | null;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../server/llms-txt-generator.js');
    setLastGenerated = mod.setLastGenerated;
    getLastGenerated = mod.getLastGenerated;
  });

  it('stores generation timestamp', () => {
    setLastGenerated('ws-fresh-1');
    const ts = getLastGenerated('ws-fresh-1');
    expect(ts).toBeTruthy();
    expect(new Date(ts!).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('returns null for workspace with no generation', () => {
    const ts = getLastGenerated('ws-never-generated');
    expect(ts).toBeNull();
  });

  it('updates existing timestamp on re-generation', async () => {
    setLastGenerated('ws-fresh-2');
    const first = getLastGenerated('ws-fresh-2');
    await new Promise(r => setTimeout(r, 10));
    setLastGenerated('ws-fresh-2');
    const second = getLastGenerated('ws-fresh-2');
    expect(new Date(second!).getTime()).toBeGreaterThanOrEqual(new Date(first!).getTime());
  });
});

// ── queueLlmsTxtRegeneration tests ──

describe('queueLlmsTxtRegeneration', () => {
  it('is exported from llms-txt-generator', async () => {
    const mod = await import('../../server/llms-txt-generator.js');
    expect(typeof mod.queueLlmsTxtRegeneration).toBe('function');
  });

  it('accepts workspaceId and trigger label', async () => {
    const mod = await import('../../server/llms-txt-generator.js');
    // Should not throw when called (even if generation fails in test env)
    expect(() => mod.queueLlmsTxtRegeneration('ws-test', 'schema_published')).not.toThrow();
  });
});
