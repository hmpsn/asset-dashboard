import { describe, expect, it } from 'vitest';
import { PageIntelligenceSurface } from '../../../src/components/page-intelligence-rebuilt/PageIntelligenceSurface';
import { REBUILT_SURFACES } from '../../../src/components/layout/rebuiltSurfaces';

describe('PageIntelligenceSurface module contract', () => {
  it('exports the standalone workspace-owned surface', () => {
    expect(PageIntelligenceSurface).toBeTypeOf('function');
  });

  it('mounts from the rebuilt registry while the flag-off legacy receiver remains available', () => {
    expect(REBUILT_SURFACES['page-intelligence']).toBeDefined();
  });
});
