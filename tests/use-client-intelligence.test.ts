import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('useClientIntelligence hook contract', () => {
  const src = readFileSync(
    join(import.meta.dirname, '../src/hooks/client/useClientIntelligence.ts'),
    'utf-8'
  );

  it('uses queryKeys.client.intelligence for the query key', () => {
    expect(src).toMatch(/queryKeys\.client\.intelligence/);
  });

  it('calls fetchClientIntelligence as queryFn', () => {
    expect(src).toMatch(/fetchClientIntelligence/);
  });

  it('has staleTime set (data changes slowly)', () => {
    expect(src).toMatch(/staleTime/);
  });

  it('is only enabled when workspaceId is truthy', () => {
    expect(src).toMatch(/enabled.*workspaceId|!!workspaceId/);
  });
});
