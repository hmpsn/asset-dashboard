import { describe, expect, it } from 'vitest';

describe('bridge-infrastructure module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/bridge-infrastructure.js');
    expect(mod).toBeDefined();
  });
});
