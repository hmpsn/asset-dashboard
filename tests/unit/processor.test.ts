import { describe, expect, it } from 'vitest';

describe('processor module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/processor.js');
    expect(mod).toBeDefined();
  });
});
