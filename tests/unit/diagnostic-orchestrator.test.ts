import { describe, expect, it } from 'vitest';

describe('diagnostic-orchestrator module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/diagnostic-orchestrator.js');
    expect(mod).toBeDefined();
  });
});
