import { describe, expect, it } from 'vitest';
import { EEAT_ASSET_TYPE } from '../../shared/types/eeat-assets.js';
import type { PageKeywordMap, Workspace } from '../../shared/types/workspace.ts';
import { buildEeatAutofillCandidates } from '../../server/eeat-assets-autofill.js';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws_test',
    name: 'Swish Dental',
    folder: 'swish-dental',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildEeatAutofillCandidates', () => {
  it('creates deterministic candidates from page intelligence trust gaps', () => {
    const pageKeywords: PageKeywordMap[] = [
      {
        pagePath: '/invisalign',
        pageTitle: 'Invisalign',
        primaryKeyword: 'invisalign sarasota',
        secondaryKeywords: [],
        missingTrustSignals: [{
          signal: 'Author expertise signals',
          rationale: 'Articles need author credentials or expert bios for E-E-A-T strength.',
          severity: 'high',
          recommendedAssetTypes: [EEAT_ASSET_TYPE.TEAM_BIO, EEAT_ASSET_TYPE.CREDENTIAL],
        }],
      },
      {
        pagePath: '/veneers',
        pageTitle: 'Veneers',
        primaryKeyword: 'veneers sarasota',
        secondaryKeywords: [],
        missingTrustSignals: [{
          signal: 'Conversion trust signals',
          rationale: 'Add proof that patients had positive outcomes.',
          severity: 'medium',
          recommendedAssetTypes: [EEAT_ASSET_TYPE.TESTIMONIAL, EEAT_ASSET_TYPE.CASE_STUDY],
        }],
      },
    ];

    const candidates = buildEeatAutofillCandidates({
      workspace: makeWorkspace(),
      pageKeywords,
      existingAssets: [],
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some(candidate => candidate.type === EEAT_ASSET_TYPE.TEAM_BIO)).toBe(true);
    expect(candidates.some(candidate => candidate.type === EEAT_ASSET_TYPE.CREDENTIAL)).toBe(true);
    expect(candidates.some(candidate => candidate.type === EEAT_ASSET_TYPE.TESTIMONIAL)).toBe(true);
    for (const candidate of candidates) {
      expect(candidate.metadata?.tags?.includes('auto-fill')).toBe(true);
    }
  });

  it('skips asset types already represented in the workspace inventory', () => {
    const pageKeywords: PageKeywordMap[] = [{
      pagePath: '/about',
      pageTitle: 'About',
      primaryKeyword: 'dental team',
      secondaryKeywords: [],
      missingTrustSignals: [{
        signal: 'Author expertise signals',
        rationale: 'Add a team bio to strengthen expertise.',
        severity: 'high',
        recommendedAssetTypes: [EEAT_ASSET_TYPE.TEAM_BIO],
      }],
    }];

    const candidates = buildEeatAutofillCandidates({
      workspace: makeWorkspace(),
      pageKeywords,
      existingAssets: [{
        id: 'asset_1',
        workspaceId: 'ws_test',
        type: EEAT_ASSET_TYPE.TEAM_BIO,
        title: 'Existing team bios',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    });

    expect(candidates.some(candidate => candidate.type === EEAT_ASSET_TYPE.TEAM_BIO)).toBe(false);
  });
});
