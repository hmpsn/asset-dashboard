import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('useClientIntelligence hook contract', () => {
  const src = readFileSync(
    join(import.meta.dirname, '../src/hooks/client/useClientIntelligence.ts'),
    'utf-8'
  );
  const viewModelSrc = readFileSync(
    join(import.meta.dirname, '../src/hooks/client/useClientInsightViewModel.ts'),
    'utf-8'
  );

  it('delegates to the client insight view-model owner', () => {
    expect(src).toMatch(/useClientIntelligenceView/);
  });

  it('uses queryKeys.client.intelligence for the query key', () => {
    expect(viewModelSrc).toMatch(/queryKeys\.client\.intelligence/);
  });

  it('calls fetchClientIntelligence as queryFn', () => {
    expect(viewModelSrc).toMatch(/fetchClientIntelligence/);
  });

  it('has staleTime set (data changes slowly)', () => {
    expect(viewModelSrc).toMatch(/staleTime/);
  });

  it('is only enabled when workspaceId is truthy', () => {
    expect(viewModelSrc).toMatch(/enabled.*workspaceId|!!workspaceId/);
  });
});
