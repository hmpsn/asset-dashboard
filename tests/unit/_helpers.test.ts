import { describe, expect, it } from 'vitest';

describe('_helpers module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/briefing-templates/_helpers.js');
    expect(mod).toBeDefined();
  });
});
