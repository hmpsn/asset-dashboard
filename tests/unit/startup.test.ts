import { describe, expect, it } from 'vitest';

describe('startup module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/startup.js');
    expect(mod).toBeDefined();
  });
});
