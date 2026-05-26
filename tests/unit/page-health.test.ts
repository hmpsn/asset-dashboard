import { describe, expect, it } from 'vitest';

describe('page-health module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/page-health.js');
    expect(mod).toBeDefined();
  });
});
