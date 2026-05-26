import { describe, expect, it } from 'vitest';

describe('we-called-it module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/we-called-it.js');
    expect(mod).toBeDefined();
  });
});
