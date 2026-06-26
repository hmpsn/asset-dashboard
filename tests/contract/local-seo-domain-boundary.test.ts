import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  applySourcePageCap as facadeApplySourcePageCap,
  candidateSourceScore as facadeCandidateSourceScore,
  classifyLocalKeywordIntent as facadeClassifyLocalKeywordIntent,
  cleanDomain as facadeCleanDomain,
  cleanKeywordDisplay as facadeCleanKeywordDisplay,
  confidencePriority as facadeConfidencePriority,
  evaluateLocalBusinessMatch as facadeEvaluateLocalBusinessMatch,
  getEffectiveLocations as facadeGetEffectiveLocations,
  hasMarketModifier as facadeHasMarketModifier,
  isOwnedLocalResult as facadeIsOwnedLocalResult,
  localVariantKeywords as facadeLocalVariantKeywords,
  localVariantKeywordsByMarket as facadeLocalVariantKeywordsByMarket,
  normalizePhone as facadeNormalizePhone,
  normalizeProviderIdentity as facadeNormalizeProviderIdentity,
  normalizeText as facadeNormalizeText,
  scrubOwnedLocalResults as facadeScrubOwnedLocalResults,
  titleLooksLikeServiceKeyword as facadeTitleLooksLikeServiceKeyword,
  iterateLocalCandidateSignals as facadeIterateLocalCandidateSignals,
} from '../../server/local-seo.js';
import {
  cleanDomain,
  confidencePriority,
  evaluateLocalBusinessMatch,
  getEffectiveLocations,
  isOwnedLocalResult,
  normalizePhone,
  normalizeProviderIdentity,
  scrubOwnedLocalResults,
} from '../../server/domains/local-seo/business-match.js';
import {
  applySourcePageCap,
  candidateSourceScore,
  classifyLocalKeywordIntent,
  cleanKeywordDisplay,
  hasMarketModifier,
  localVariantKeywords,
  localVariantKeywordsByMarket,
  normalizeText,
  titleLooksLikeServiceKeyword,
} from '../../server/domains/local-seo/keyword-intent.js';
import {
  buildWorkspaceGeoRegex,
  buildWorkspaceServiceTermRegex,
  deriveLocalSeoPosture,
} from '../../server/domains/local-seo/workspace-classifiers.js';
import {
  buildLocalSeoKeywordCandidatesEvaluatedFromContext,
  buildLocalSeoKeywordCandidatesFromContext,
  countLocalSeoKeywordCandidatesFromContext,
  hasLocalIntentForWorkspace,
  iterateLocalCandidateSignals,
} from '../../server/domains/local-seo/candidate-pipeline.js';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8'); // readFile-ok - source contract checks local SEO facade/domain ownership.
}

describe('local SEO domain boundary', () => {
  it('keeps keyword intent helpers in the domain module with direct facade re-exports', () => {
    const facade = readRepoFile('server/local-seo.ts');
    const keywordIntent = readRepoFile('server/domains/local-seo/keyword-intent.ts');

    for (const helper of [
      'applySourcePageCap',
      'candidateSourceScore',
      'classifyLocalKeywordIntent',
      'cleanKeywordDisplay',
      'hasMarketModifier',
      'localVariantKeywords',
      'localVariantKeywordsByMarket',
      'normalizeText',
      'titleLooksLikeServiceKeyword',
    ]) {
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(keywordIntent).toMatch(new RegExp(`function ${helper}\\b`));
    }
    expect(facade).toContain("from './domains/local-seo/keyword-intent.js'");
    expect(facadeApplySourcePageCap).toBe(applySourcePageCap);
    expect(facadeCandidateSourceScore).toBe(candidateSourceScore);
    expect(facadeClassifyLocalKeywordIntent).toBe(classifyLocalKeywordIntent);
    expect(facadeCleanKeywordDisplay).toBe(cleanKeywordDisplay);
    expect(facadeHasMarketModifier).toBe(hasMarketModifier);
    expect(facadeLocalVariantKeywords).toBe(localVariantKeywords);
    expect(facadeLocalVariantKeywordsByMarket).toBe(localVariantKeywordsByMarket);
    expect(facadeNormalizeText).toBe(normalizeText);
    expect(facadeTitleLooksLikeServiceKeyword).toBe(titleLooksLikeServiceKeyword);
  });

  it('keeps business matching helpers in the domain module with direct facade re-exports', () => {
    const facade = readRepoFile('server/local-seo.ts');
    const businessMatch = readRepoFile('server/domains/local-seo/business-match.ts');

    for (const helper of [
      'cleanDomain',
      'confidencePriority',
      'evaluateLocalBusinessMatch',
      'getEffectiveLocations',
      'isOwnedLocalResult',
      'normalizePhone',
      'normalizeProviderIdentity',
      'scrubOwnedLocalResults',
    ]) {
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(businessMatch).toMatch(new RegExp(`function ${helper}\\b`));
    }
    expect(facade).toContain("from './domains/local-seo/business-match.js'");
    expect(facadeCleanDomain).toBe(cleanDomain);
    expect(facadeConfidencePriority).toBe(confidencePriority);
    expect(facadeEvaluateLocalBusinessMatch).toBe(evaluateLocalBusinessMatch);
    expect(facadeGetEffectiveLocations).toBe(getEffectiveLocations);
    expect(facadeIsOwnedLocalResult).toBe(isOwnedLocalResult);
    expect(facadeNormalizePhone).toBe(normalizePhone);
    expect(facadeNormalizeProviderIdentity).toBe(normalizeProviderIdentity);
    expect(facadeScrubOwnedLocalResults).toBe(scrubOwnedLocalResults);
  });

  it('moves production-only helper consumers off the local SEO facade', () => {
    expect(readRepoFile('server/llm-mentions.ts')).toContain("from './domains/local-seo/business-match.js'");
    expect(readRepoFile('server/national-serp.ts')).toContain("from './domains/local-seo/business-match.js'");
    expect(readRepoFile('server/scoring/keyword-value-score.ts')).toContain("from '../domains/local-seo/keyword-intent.js'");
  });

  it('keeps workspace classifier helpers in the domain module without widening the facade', () => {
    const facade = readRepoFile('server/local-seo.ts');
    const workspaceClassifiers = readRepoFile('server/domains/local-seo/workspace-classifiers.ts');

    for (const helper of [
      'buildWorkspaceGeoRegex',
      'buildWorkspaceServiceTermRegex',
      'deriveLocalSeoPosture',
    ]) {
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(workspaceClassifiers).toMatch(new RegExp(`function ${helper}\\b`));
    }
    expect(facade).toContain("from './domains/local-seo/workspace-classifiers.js'");
    expect(facade).not.toMatch(/export\s+\{[^}]*buildWorkspaceGeoRegex/s);
    expect(facade).not.toMatch(/export\s+\{[^}]*buildWorkspaceServiceTermRegex/s);
    expect(facade).not.toMatch(/export\s+\{[^}]*deriveLocalSeoPosture/s);
    expect(typeof buildWorkspaceGeoRegex).toBe('function');
    expect(typeof buildWorkspaceServiceTermRegex).toBe('function');
    expect(typeof deriveLocalSeoPosture).toBe('function');
  });

  it('keeps candidate pipeline assembly in the domain module with compatibility facade exports', () => {
    const facade = readRepoFile('server/local-seo.ts');
    const pipeline = readRepoFile('server/domains/local-seo/candidate-pipeline.ts');

    for (const helper of [
      'iterateLocalCandidateSignals',
      'buildLocalSeoKeywordCandidatesFromContext',
      'buildLocalSeoKeywordCandidatesEvaluatedFromContext',
      'countLocalSeoKeywordCandidatesFromContext',
      'hasLocalIntentForWorkspace',
    ]) {
      expect(pipeline).toMatch(new RegExp(`(function\\*?|function) ${helper}\\b`));
    }
    expect(facade).not.toMatch(/function\*?\s+iterateLocalCandidateSignals\b/);
    expect(facade).not.toMatch(/function\s+upsertCandidate\b/);
    expect(facade).not.toMatch(/function\s+hasLocalIntent\b/);
    expect(facade).toContain("from './domains/local-seo/candidate-pipeline.js'");
    expect(facade).not.toMatch(/export\s+\{[^}]*buildLocalSeoKeywordCandidatesFromContext/s);
    expect(facade).not.toMatch(/export\s+\{[^}]*buildLocalSeoKeywordCandidatesEvaluatedFromContext/s);
    expect(facade).not.toMatch(/export\s+\{[^}]*countLocalSeoKeywordCandidatesFromContext/s);
    expect(facadeIterateLocalCandidateSignals).toBe(iterateLocalCandidateSignals);
    expect(typeof iterateLocalCandidateSignals).toBe('function');
    expect(typeof buildLocalSeoKeywordCandidatesFromContext).toBe('function');
    expect(typeof buildLocalSeoKeywordCandidatesEvaluatedFromContext).toBe('function');
    expect(typeof countLocalSeoKeywordCandidatesFromContext).toBe('function');
    expect(typeof hasLocalIntentForWorkspace).toBe('function');
  });
});
