import { describe, expect, it } from 'vitest';

describe('external-detection module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/external-detection.js');
    expect(mod).toBeDefined();
  });
});
