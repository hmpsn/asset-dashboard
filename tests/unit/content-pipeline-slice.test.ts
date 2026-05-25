import { describe, expect, it } from 'vitest';

describe('content-pipeline-slice module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/intelligence/content-pipeline-slice.js');
    expect(mod).toBeDefined();
  });
});
