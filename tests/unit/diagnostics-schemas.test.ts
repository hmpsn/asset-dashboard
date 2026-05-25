import { describe, expect, it } from 'vitest';

describe('diagnostics-schemas module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schemas/diagnostics-schemas.js');
    expect(mod).toBeDefined();
  });
});
