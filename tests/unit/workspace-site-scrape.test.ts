import { describe, expect, it } from 'vitest';

describe('workspace-site-scrape module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/workspace-site-scrape.js');
    expect(mod).toBeDefined();
  });
});
