import { describe, expect, it } from 'vitest';

describe('workspace-schemas module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schemas/workspace-schemas.js');
    expect(mod).toBeDefined();
  });
});
