import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const serviceSource = readFileSync(
  join(import.meta.dirname, '../../server/domains/brand-content-onboarding/service.ts'),
  'utf8',
); // readFile-ok -- safety contract guards orchestration side-effect boundaries.

describe('brand content onboarding safety boundary', () => {
  it('coordinates existing gates without sending, approving, or publishing on its own', () => {
    expect(serviceSource).not.toContain('createBrandReviewDeliverable(');
    expect(serviceSource).not.toContain('applyBrandReviewDecision(');
    expect(serviceSource).not.toContain('approveMatrixPageForPublishReadiness(');
    expect(serviceSource).not.toContain('createContentPublishJob(');
    expect(serviceSource).not.toMatch(/\bpublishPostToWebflow\s*\(/);
  });
});
