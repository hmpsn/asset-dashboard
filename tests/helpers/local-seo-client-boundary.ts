import { expect } from 'vitest';

const LOCAL_SEO_CLIENT_BOUNDARY_FIELDS = [
  'localSeo',
  'localSeoState',
  'localSeoVisibility',
  'localVisibility',
  'localMarkets',
  'localSeoMarkets',
  'latestSnapshots',
  'localSeoSnapshots',
  'visibilitySnapshots',
  'candidateKeywords',
  'localSeoCandidates',
  'effectiveLocalSeoBlock',
  'localSeoPromptBlock',
  'serviceCoverageGaps',
  'repeatCompetitors',
] as const;

export function expectNoLocalSeoClientBoundaryFields(
  body: Record<string, unknown>,
  label = 'client response',
): void {
  for (const field of LOCAL_SEO_CLIENT_BOUNDARY_FIELDS) {
    expect(body[field], `${label} should not expose ${field}`).toBeUndefined();
  }
}
