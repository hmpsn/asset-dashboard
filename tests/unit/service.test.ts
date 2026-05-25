import { describe, expect, it } from 'vitest';

describe('service module smoke', () => {
  it('loads module successfully', async () => {
    const mod = await import('../../server/schema/templates/service.js');
    expect(mod).toBeDefined();
  });
});
