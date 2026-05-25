import { describe, expect, it } from 'vitest';

describe('web-scraper module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/web-scraper.js');
    expect(mod).toBeDefined();
  });
});
