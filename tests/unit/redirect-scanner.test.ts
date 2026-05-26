import { describe, expect, it } from 'vitest';

describe('redirect-scanner module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/redirect-scanner.js');
    expect(mod).toBeDefined();
  });
});
