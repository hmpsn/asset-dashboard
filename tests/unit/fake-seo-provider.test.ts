import { describe, expect, it } from 'vitest';
import { FakeSeoProvider } from '../../server/providers/fake-seo-provider.js';

describe('FakeSeoProvider', () => {
  const provider = new FakeSeoProvider();

  it('reports configured and returns deterministic keyword metrics', async () => {
    expect(provider.isConfigured()).toBe(true);
    const rows = await provider.getKeywordMetrics(['plumber chicago', 'hvac near me'], 'ws_demo_growth');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.keyword).toBe('plumber chicago');
    expect(rows[0]?.trend).toHaveLength(12);
  });

  it('handles invalid URLs when resolving URL keywords', async () => {
    const rows = await provider.getUrlKeywords('not-a-valid-url', 'ws_demo_growth', 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.url).toContain('example.com');
  });
});
