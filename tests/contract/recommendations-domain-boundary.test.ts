import { readdirSync, readFileSync, statSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  INTENT_STOPWORDS as facadeIntentStopwords,
  RecSource as facadeRecSource,
  applyLifecycleCarryOver as facadeApplyLifecycleCarryOver,
  auditInsight as facadeAuditInsight,
  buildMergeKey as facadeBuildMergeKey,
  buildOvGainString as facadeBuildOvGainString,
  cannibalizationUrlSetKey as facadeCannibalizationUrlSetKey,
  checkToRecType as facadeCheckToRecType,
  computeRecommendationSummary as facadeComputeRecommendationSummary,
  deriveOvTier as facadeDeriveOvTier,
  getRecSourceCategory as facadeGetRecSourceCategory,
  getRecoveryRate as facadeGetRecoveryRate,
  getTrafficScore as facadeGetTrafficScore,
  inferPageType as facadeInferPageType,
  inferSchemaTypes as facadeInferSchemaTypes,
  isExemptFromAutoResolve as facadeIsExemptFromAutoResolve,
  isIntentMismatch as facadeIsIntentMismatch,
  isOperatorMintedRec as facadeIsOperatorMintedRec,
  isRecIntentAligned as facadeIsRecIntentAligned,
  mapToProduct as facadeMapToProduct,
  migrateSourceKey as facadeMigrateSourceKey,
  pageImportanceMultiplier as facadePageImportanceMultiplier,
  resolveEstimatedGain as facadeResolveEstimatedGain,
  sortRecommendations as facadeSortRecommendations,
  toPageSlug as facadeToPageSlug,
} from '../../server/recommendations.js';
import {
  INTENT_STOPWORDS,
  RecSource,
  applyLifecycleCarryOver,
  auditInsight,
  buildMergeKey,
  buildOvGainString,
  cannibalizationUrlSetKey,
  checkToRecType,
  computeRecommendationSummary,
  deriveOvTier,
  getRecSourceCategory,
  getRecoveryRate,
  getTrafficScore,
  inferPageType,
  inferSchemaTypes,
  isExemptFromAutoResolve,
  isIntentMismatch,
  isOperatorMintedRec,
  isRecIntentAligned,
  mapToProduct,
  migrateSourceKey,
  pageImportanceMultiplier,
  resolveEstimatedGain,
  sortRecommendations,
  toPageSlug,
} from '../../server/domains/recommendations/rules.js';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8'); // readFile-ok - source contract checks recommendation facade/domain ownership.
}

function listServerProductionFiles(dir = 'server'): string[] {
  const entries = readdirSync(new URL(`${dir}/`, repoRoot), { withFileTypes: true }); // readdir-ok - source contract checks recommendation facade/domain ownership.
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...listServerProductionFiles(relativePath));
      continue;
    }
    if (!entry.isFile() || !relativePath.endsWith('.ts')) continue;
    files.push(relativePath);
  }

  return files;
}

function repoFileExists(relativePath: string): boolean {
  try {
    return statSync(new URL(relativePath, repoRoot)).isFile();
  } catch {
    return false;
  }
}

describe('recommendations domain boundary', () => {
  it('keeps pure recommendation rules in the domain module with compatibility facade exports', () => {
    const facade = readRepoFile('server/recommendations.ts');
    const rules = readRepoFile('server/domains/recommendations/rules.ts');

    for (const helper of [
      'getRecoveryRate',
      'buildOvGainString',
      'applyLifecycleCarryOver',
      'getRecSourceCategory',
      'inferPageType',
      'isIntentMismatch',
      'computeRecommendationSummary',
      'isRecIntentAligned',
      'sortRecommendations',
      'deriveOvTier',
      'getTrafficScore',
      'toPageSlug',
      'migrateSourceKey',
      'buildMergeKey',
      'isOperatorMintedRec',
      'pageImportanceMultiplier',
      'checkToRecType',
      'mapToProduct',
      'inferSchemaTypes',
      'auditInsight',
    ]) {
      expect(rules).toMatch(new RegExp(`function ${helper}\\b`));
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
    }

    expect(rules).toContain('export type RecSourceCategory');
    expect(rules).toContain('REC_SOURCE_CATEGORIES');
    expect(facade).not.toContain('REC_SOURCE_CATEGORIES');
    expect(facade).toContain("from './domains/recommendations/rules.js'");

    expect(facadeRecSource).toBe(RecSource);
    expect(facadeIntentStopwords).toBe(INTENT_STOPWORDS);
    expect(facadeApplyLifecycleCarryOver).toBe(applyLifecycleCarryOver);
    expect(facadeGetRecoveryRate).toBe(getRecoveryRate);
    expect(facadeBuildOvGainString).toBe(buildOvGainString);
    expect(facadeGetRecSourceCategory).toBe(getRecSourceCategory);
    expect(facadeInferPageType).toBe(inferPageType);
    expect(facadeIsIntentMismatch).toBe(isIntentMismatch);
    expect(facadeComputeRecommendationSummary).toBe(computeRecommendationSummary);
    expect(facadeIsRecIntentAligned).toBe(isRecIntentAligned);
    expect(facadeSortRecommendations).toBe(sortRecommendations);
    expect(facadeDeriveOvTier).toBe(deriveOvTier);
    expect(facadeGetTrafficScore).toBe(getTrafficScore);
    expect(facadeToPageSlug).toBe(toPageSlug);
    expect(facadeCannibalizationUrlSetKey).toBe(cannibalizationUrlSetKey);
    expect(facadeMigrateSourceKey).toBe(migrateSourceKey);
    expect(facadeBuildMergeKey).toBe(buildMergeKey);
    expect(facadeIsExemptFromAutoResolve).toBe(isExemptFromAutoResolve);
    expect(facadeIsOperatorMintedRec).toBe(isOperatorMintedRec);
    expect(facadePageImportanceMultiplier).toBe(pageImportanceMultiplier);
    expect(facadeCheckToRecType).toBe(checkToRecType);
    expect(facadeMapToProduct).toBe(mapToProduct);
    expect(facadeInferSchemaTypes).toBe(inferSchemaTypes);
    expect(facadeAuditInsight).toBe(auditInsight);
    expect(facadeResolveEstimatedGain).toBe(resolveEstimatedGain);
  });

  it('keeps the RecType to outcome mapping exhaustive in the facade', () => {
    const facade = readRepoFile('server/recommendations.ts');
    const rules = readRepoFile('server/domains/recommendations/rules.ts');

    expect(facade).toMatch(/function recommendationOutcomeActionType\b/);
    expect(facade).toContain('const _exhaustive: never = type');
    expect(rules).not.toMatch(/function recommendationOutcomeActionType\b/);
  });

  it('keeps read-only recommendation producer stages outside the facade', () => {
    const facade = readRepoFile('server/recommendations.ts');
    const producers = readRepoFile('server/domains/recommendations/generation-producers.ts');

    for (const helper of [
      'appendAuditRecommendations',
      'appendStrategyRecommendations',
      'appendContentDecayRecommendations',
      'appendCtrOpportunityRecommendations',
      'appendDiagnosticRecommendations',
      'appendFreshnessRecommendations',
      'appendLocalVisibilityRecommendations',
    ]) {
      expect(producers).toMatch(new RegExp(`function ${helper}\\b`));
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
    }

    expect(facade).toContain("from './domains/recommendations/generation-producers.js'");
    expect(producers).toContain('Keyword gaps unavailable for recommendations');
    expect(facade).not.toContain('Keyword gaps unavailable for recommendations');
    expect(producers).toContain("failedCategories.add('cannibalization')");
    expect(producers).toContain('Content decay data unavailable for recommendations');
    expect(facade).not.toContain('Content decay data unavailable for recommendations');
    expect(producers).toContain("failedCategories.add('insight:freshness_alert')");
    expect(producers).toContain('Local service gaps unavailable for recommendations');
    expect(producers).toContain('GBP + reviews listings unavailable for recommendations');
    expect(facade).not.toContain('Local service gaps unavailable for recommendations');
    expect(facade).not.toContain('GBP + reviews listings unavailable for recommendations');
  });

  it('keeps recommendation finalization stages outside the facade', () => {
    const facade = readRepoFile('server/recommendations.ts');
    const finalization = readRepoFile('server/domains/recommendations/finalization.ts');

    expect(finalization).toMatch(/function finalizeRecommendations\b/);
    expect(finalization).toContain('function mintSignalRecs');
    expect(finalization).toContain('signal-fold: minted intelligence signals as recommendations');
    expect(finalization).toContain('applyLifecycleCarryOver(recs');
    expect(finalization).toContain('autoResolvedPageStateIds.push(resolvedPageId)');
    expect(finalization).toContain('sortRecommendations(recs, effectiveBusinessPriorities');
    expect(facade).toContain("from './domains/recommendations/finalization.js'");
    expect(facade).toContain('finalizeRecommendations(recs');
    expect(facade).not.toContain('function mintSignalRecs');
    expect(facade).not.toContain('signal-fold: minted intelligence signals as recommendations');
    expect(facade).not.toContain('applyLifecycleCarryOver(recs');
    expect(facade).not.toContain('sortRecommendations(recs, effectiveBusinessPriorities');
  });

  it('keeps recommendation storage and resolution mutations in domain-owned modules', () => {
    const facade = readRepoFile('server/recommendations.ts');
    const storage = readRepoFile('server/domains/recommendations/storage.ts');
    const resolution = readRepoFile('server/domains/recommendations/resolution-service.ts');

    expect(storage).toContain('recommendation_items');
    expect(storage).toMatch(/function loadRecommendationSet\b/);
    expect(storage).toMatch(/function saveRecommendationSet\b/);
    expect(storage).toMatch(/function setRecommendationItemStatus\b/);
    expect(storage).toMatch(/function mutateRecommendationItem\b/);
    expect(facade).toContain("from './domains/recommendations/storage.js'");
    expect(facade).not.toContain("from './recommendation-storage.js'");

    for (const helper of [
      'resolveRecommendationsForChange',
      'resolveRecommendationsForPageIds',
      'resolveContentRecommendationsForPublishedPost',
    ]) {
      expect(resolution).toMatch(new RegExp(`function ${helper}\\b`));
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
    }
    expect(facade).toContain("from './domains/recommendations/resolution-service.js'");

    const resolverHelpers = [
      'resolveRecommendationsForChange',
      'resolveRecommendationsForPageIds',
      'resolveContentRecommendationsForPublishedPost',
    ];
    const facadeResolverImportOffenders = listServerProductionFiles()
      .filter((file) => file !== 'server/recommendations.ts')
      .flatMap((file) => {
        const source = readRepoFile(file);
        const matches = [...source.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]*recommendations\.js)['"]/g)];
        return matches.flatMap((match) => {
          const importedNames = match[1]
            .split(',')
            .map((name) => name.trim().split(/\s+as\s+/)[0]?.trim())
            .filter(Boolean);
          const resolverImports = importedNames.filter((name) => resolverHelpers.includes(name));
          return resolverImports.map((name) => `${file}: ${name} from ${match[2]}`);
        });
      });

    expect(facadeResolverImportOffenders).toEqual([]);

    const resolverConsumers = listServerProductionFiles()
      .filter((file) => file !== 'server/recommendations.ts')
      .filter((file) => {
        const source = readRepoFile(file);
        return resolverHelpers.some((helper) => new RegExp(`\\b${helper}\\s*\\(`).test(source));
      })
      .filter((file) => !file.startsWith('server/domains/recommendations/'));

    for (const file of resolverConsumers) {
      const source = readRepoFile(file);
      expect(source).toContain('recommendations/resolution-service.js');
    }
    expect(repoFileExists('server/recommendation-storage.ts')).toBe(false);
  });
});
