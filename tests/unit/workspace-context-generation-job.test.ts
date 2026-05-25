import { describe, expect, it } from 'vitest';

describe('workspace-context-generation-job module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/workspace-context-generation-job.js');
    expect(mod).toBeDefined();
  });
});
