import { describe, expect, it } from 'vitest';

describe('seo-audit-site-checks module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/seo-audit-site-checks.js');
    expect(mod).toBeDefined();
  });
});
