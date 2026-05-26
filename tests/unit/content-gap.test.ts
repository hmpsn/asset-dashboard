import { describe, expect, it } from 'vitest';

describe('content-gap module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/content-gap.js');
    expect(mod).toBeDefined();
  });
});
