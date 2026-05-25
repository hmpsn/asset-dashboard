import { describe, expect, it } from 'vitest';

describe('abort-helpers module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/abort-helpers.js');
    expect(mod).toBeDefined();
  });
});
