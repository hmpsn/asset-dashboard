import { describe, expect, it } from 'vitest';

describe('risky module smoke: src/components/schema/SchemaPlanPanel.tsx', () => {
  it('loads without throwing', async () => {
    const loaded = await import('../../../src/components/schema/SchemaPlanPanel.tsx');
    expect(loaded).toBeDefined();
    expect(typeof loaded).toBe('object');
  });

  it('rejects invalid module import paths', async () => {
    const invalidPath = '../../../src/components/schema/SchemaPlanPanel.tsx.invalid';
    await expect(import(/* @vite-ignore */ invalidPath)).rejects.toBeDefined();
  });
});
