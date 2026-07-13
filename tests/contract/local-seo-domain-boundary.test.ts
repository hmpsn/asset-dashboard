import { readdirSync, readFileSync, realpathSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  LOCAL_SEO_MAX_MARKETS as facadeLocalSeoMaxMarkets,
  RETENTION_PRUNE_BATCH_SIZE as facadeRetentionPruneBatchSize,
  RETENTION_RAW_DAYS as facadeRetentionRawDays,
  RETENTION_WEEKLY_MAX_DAYS as facadeRetentionWeeklyMaxDays,
  applySourcePageCap as facadeApplySourcePageCap,
  buildLocalSeoKeywordCandidates as facadeBuildLocalSeoKeywordCandidates,
  buildLocalSeoKeywordCandidatesEvaluated as facadeBuildLocalSeoKeywordCandidatesEvaluated,
  buildLocalSeoKeywordVisibilityByKey as facadeBuildLocalSeoKeywordVisibilityByKey,
  buildLocalSeoKeywordVisibilityForKeyword as facadeBuildLocalSeoKeywordVisibilityForKeyword,
  buildLocalSeoKeywordVisibilitySummaryByKey as facadeBuildLocalSeoKeywordVisibilitySummaryByKey,
  candidateSourceScore as facadeCandidateSourceScore,
  classifyLocalKeywordIntent as facadeClassifyLocalKeywordIntent,
  cleanDomain as facadeCleanDomain,
  cleanKeywordDisplay as facadeCleanKeywordDisplay,
  confidencePriority as facadeConfidencePriority,
  countLocalSeoKeywordCandidates as facadeCountLocalSeoKeywordCandidates,
  countLocalVisibilitySnapshots as facadeCountLocalVisibilitySnapshots,
  createLocalSeoRefreshPlan as facadeCreateLocalSeoRefreshPlan,
  evaluateLocalBusinessMatch as facadeEvaluateLocalBusinessMatch,
  getEffectiveLocations as facadeGetEffectiveLocations,
  getEffectiveKeywordsPerRefresh as facadeGetEffectiveKeywordsPerRefresh,
  getLocalSeoReadModel as facadeGetLocalSeoReadModel,
  getLocalSeoPosture as facadeGetLocalSeoPosture,
  getLocalSeoCompetitorBrands as facadeGetLocalSeoCompetitorBrands,
  getLocalSeoServiceGaps as facadeGetLocalSeoServiceGaps,
  getLocalSeoVisibilityTrend as facadeGetLocalSeoVisibilityTrend,
  getPrimaryMarketLocationCode as facadeGetPrimaryMarketLocationCode,
  hasMarketModifier as facadeHasMarketModifier,
  isOwnedLocalResult as facadeIsOwnedLocalResult,
  latestLocalSnapshotAt as facadeLatestLocalSnapshotAt,
  listLocalSeoMarkets as facadeListLocalSeoMarkets,
  listLatestLocalVisibilitySnapshots as facadeListLatestLocalVisibilitySnapshots,
  loadCandidateIterationContext as facadeLoadCandidateIterationContext,
  localVariantKeywords as facadeLocalVariantKeywords,
  localVariantKeywordsByMarket as facadeLocalVariantKeywordsByMarket,
  normalizePhone as facadeNormalizePhone,
  normalizeProviderIdentity as facadeNormalizeProviderIdentity,
  normalizeText as facadeNormalizeText,
  resolveLocalSeoProviderLocation as facadeResolveLocalSeoProviderLocation,
  resolveWorkspaceLanguageCode as facadeResolveWorkspaceLanguageCode,
  resolveWorkspaceLocationCode as facadeResolveWorkspaceLocationCode,
  resolveWorkspaceTargetGeo as facadeResolveWorkspaceTargetGeo,
  runLocalSeoRefreshJob as facadeRunLocalSeoRefreshJob,
  runLocationBackfillJob as facadeRunLocationBackfillJob,
  runSnapshotRetentionPrune as facadeRunSnapshotRetentionPrune,
  scrubOwnedLocalResults as facadeScrubOwnedLocalResults,
  selectLocalIntentKeywords as facadeSelectLocalIntentKeywords,
  setPrimaryMarket as facadeSetPrimaryMarket,
  titleLooksLikeServiceKeyword as facadeTitleLooksLikeServiceKeyword,
  iterateLocalCandidateSignals as facadeIterateLocalCandidateSignals,
  updateLocalSeoConfiguration as facadeUpdateLocalSeoConfiguration,
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
import {
  buildLocalSeoKeywordCandidates,
  buildLocalSeoKeywordCandidatesEvaluated,
  countLocalSeoKeywordCandidates,
  createLocalSeoRefreshPlan,
  loadCandidateIterationContext,
  selectLocalIntentKeywords,
} from '../../server/domains/local-seo/candidate-service.js';
import {
  setPrimaryMarket,
  updateLocalSeoConfiguration,
} from '../../server/domains/local-seo/configuration-actions.js';
import {
  LOCAL_SEO_MAX_MARKETS,
  getEffectiveKeywordsPerRefresh,
  getLocalSeoPosture,
  getPrimaryMarketLocationCode,
  listLocalSeoMarkets,
  resolveWorkspaceLanguageCode,
  resolveWorkspaceLocationCode,
  resolveWorkspaceTargetGeo,
} from '../../server/domains/local-seo/configuration-service.js';
import {
  RETENTION_PRUNE_BATCH_SIZE,
  RETENTION_RAW_DAYS,
  RETENTION_WEEKLY_MAX_DAYS,
  buildLocalSeoKeywordVisibilityByKey,
  buildLocalSeoKeywordVisibilityForKeyword,
  buildLocalSeoKeywordVisibilitySummaryByKey,
  countLocalVisibilitySnapshots,
  getLocalSeoVisibilityTrend,
  latestLocalSnapshotAt,
  listLatestLocalVisibilitySnapshots,
  runSnapshotRetentionPrune,
} from '../../server/domains/local-seo/snapshot-store.js';
import {
  getLocalSeoCompetitorBrands,
  getLocalSeoServiceGaps,
} from '../../server/domains/local-seo/visibility-read-model.js';
import {
  getLocalSeoReadModel,
} from '../../server/domains/local-seo/read-service.js';
import {
  resolveLocalSeoProviderLocation,
  runLocalSeoRefreshJob,
  runLocationBackfillJob,
} from '../../server/domains/local-seo/refresh-runner.js';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8'); // readFile-ok - source contract checks local SEO facade/domain ownership.
}

function isServerLocalSeoFacadeImport(file: string, importPath: string): boolean {
  if (!importPath.startsWith('.')) return false;
  try {
    const fileUrl = new URL(file, repoRoot);
    const resolved = realpathSync(new URL(`${importPath.replace(/\.js$/, '.ts')}`, fileUrl));
    return resolved === realpathSync(new URL('server/local-seo.ts', repoRoot));
  } catch {
    return false;
  }
}

function listServerProductionFiles(dir = 'server'): string[] {
  const entries = readdirSync(new URL(`${dir}/`, repoRoot), { withFileTypes: true }); // readdir-ok - source contract checks local SEO facade/domain ownership.
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

    const domainOnlyHelpers = [
      'applySourcePageCap',
      'candidateSourceScore',
      'classifyLocalKeywordIntent',
      'cleanDomain',
      'cleanKeywordDisplay',
      'confidencePriority',
      'evaluateLocalBusinessMatch',
      'getEffectiveLocations',
      'hasMarketModifier',
      'isOwnedLocalResult',
      'localVariantKeywords',
      'localVariantKeywordsByMarket',
      'normalizePhone',
      'normalizeProviderIdentity',
      'normalizeText',
      'scrubOwnedLocalResults',
      'titleLooksLikeServiceKeyword',
      'iterateLocalCandidateSignals',
    ];
    const facadeImportOffenders = listServerProductionFiles()
      .filter((file) => file !== 'server/local-seo.ts')
      .flatMap((file) => {
        const source = readRepoFile(file);
        const matches = [...source.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]*local-seo\.js)['"]/g)]
          .filter((match) => isServerLocalSeoFacadeImport(file, match[2]));
        return matches.flatMap((match) => {
          const importedNames = match[1]
            .split(',')
            .map((name) => name.trim().split(/\s+as\s+/)[0]?.trim())
            .filter(Boolean);
          const domainOnlyImports = importedNames.filter((name) => domainOnlyHelpers.includes(name));
          return domainOnlyImports.map((name) => `${file}: ${name} from ${match[2]}`);
        });
      });

    expect(facadeImportOffenders).toEqual([]);
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
    expect(facade).not.toContain("from './domains/local-seo/workspace-classifiers.js'");
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

  it('keeps candidate context, selection, and refresh planning in the domain candidate service', () => {
    const facade = readRepoFile('server/local-seo.ts');
    const candidateService = readRepoFile('server/domains/local-seo/candidate-service.ts');

    for (const helper of [
      'loadCandidateIterationContext',
      'buildLocalSeoKeywordCandidates',
      'buildLocalSeoKeywordCandidatesEvaluated',
      'countLocalSeoKeywordCandidates',
      'selectLocalIntentKeywords',
      'createLocalSeoRefreshPlan',
    ]) {
      expect(candidateService).toMatch(new RegExp(`function ${helper}\\b`));
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
    }

    for (const movedDetail of [
      'LOCAL_CANDIDATE_HARD_CAP',
      'selectExplicitLocalSeoKeywords',
      'buildCandidateContext',
      'warnLocalSeoCandidateHardCap',
      'getTrackedKeywords',
      'listContentGaps',
      'getDeclinedKeywords',
      'getRequestedKeywords',
    ]) {
      expect(candidateService).toContain(movedDetail);
      expect(facade).not.toContain(movedDetail);
    }

    expect(facade).toContain("from './domains/local-seo/candidate-service.js'");
    expect(facadeLoadCandidateIterationContext).toBe(loadCandidateIterationContext);
    expect(facadeBuildLocalSeoKeywordCandidates).toBe(buildLocalSeoKeywordCandidates);
    expect(facadeBuildLocalSeoKeywordCandidatesEvaluated).toBe(buildLocalSeoKeywordCandidatesEvaluated);
    expect(facadeCountLocalSeoKeywordCandidates).toBe(countLocalSeoKeywordCandidates);
    expect(facadeSelectLocalIntentKeywords).toBe(selectLocalIntentKeywords);
    expect(facadeCreateLocalSeoRefreshPlan).toBe(createLocalSeoRefreshPlan);
  });

  it('keeps settings, markets, and target geo ownership in the domain configuration service', () => {
    const facade = readRepoFile('server/local-seo.ts');
    const configuration = readRepoFile('server/domains/local-seo/configuration-service.ts');

    for (const helper of [
      'getEffectiveKeywordsPerRefresh',
      'getLocalSeoPosture',
      'listLocalSeoMarkets',
      'getPrimaryMarketLocationCode',
      'resolveWorkspaceLocationCode',
      'resolveWorkspaceLanguageCode',
      'resolveWorkspaceTargetGeo',
      'readLocalSeoSettings',
      'applyLocalSeoConfigurationUpdate',
      'activeLocalSeoMarkets',
      'buildSuggestedLocalSeoMarkets',
      'disabledLocalSeoSettings',
    ]) {
      expect(configuration).toMatch(new RegExp(`function ${helper}\\b`));
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
    }

    for (const movedStoreDetail of [
      'upsertSettings',
      'upsertMarket',
      'getPrimaryMarketLanguage',
      'rowToMarket',
      'rowToSettings',
      'TARGET_GEO_LOCATION_NAMES_BY_CODE',
    ]) {
      expect(configuration).toContain(movedStoreDetail);
      expect(facade).not.toContain(movedStoreDetail);
    }

    expect(facade).toContain("from './domains/local-seo/configuration-service.js'");
    expect(facadeLocalSeoMaxMarkets).toBe(LOCAL_SEO_MAX_MARKETS);
    expect(facadeGetEffectiveKeywordsPerRefresh).toBe(getEffectiveKeywordsPerRefresh);
    expect(facadeGetLocalSeoPosture).toBe(getLocalSeoPosture);
    expect(facadeListLocalSeoMarkets).toBe(listLocalSeoMarkets);
    expect(facadeGetPrimaryMarketLocationCode).toBe(getPrimaryMarketLocationCode);
    expect(facadeResolveWorkspaceLocationCode).toBe(resolveWorkspaceLocationCode);
    expect(facadeResolveWorkspaceLanguageCode).toBe(resolveWorkspaceLanguageCode);
    expect(facadeResolveWorkspaceTargetGeo).toBe(resolveWorkspaceTargetGeo);
  });

  it('keeps local visibility snapshot storage and read projections out of the facade', () => {
    const facade = readRepoFile('server/local-seo.ts');
    const snapshotStore = readRepoFile('server/domains/local-seo/snapshot-store.ts');
    const readModel = readRepoFile('server/domains/local-seo/visibility-read-model.ts');

    for (const storeDetail of [
      'createStmtCache',
      'local_visibility_snapshots',
      'rowToSnapshot',
      'rowToRawLocalResults',
      'listSnapshotsPageForBackfill',
      'retentionRowsFirstPage',
      'retentionRowsPage',
      'deleteSnapshotById',
      'visibilityTrendV2Aggregates',
      'visibilityTrendLegacyPage',
      'latestSnapshotSummary',
    ]) {
      expect(snapshotStore).toContain(storeDetail);
      expect(facade).not.toContain(storeDetail);
    }

    for (const helper of [
      'listLatestLocalVisibilitySnapshots',
      'buildLocalSeoKeywordVisibilitySummaryByKey',
      'buildLocalSeoKeywordVisibilityByKey',
      'buildLocalSeoKeywordVisibilityForKeyword',
      'getLocalSeoVisibilityTrend',
      'countLocalVisibilitySnapshots',
      'latestLocalSnapshotAt',
      'runSnapshotRetentionPrune',
    ]) {
      expect(snapshotStore).toMatch(new RegExp(`function ${helper}\\b`));
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
    }

    for (const helper of [
      'getLocalSeoCompetitorBrands',
      'getLocalSeoServiceGaps',
      'buildLocalSeoReportSummary',
      'buildLocalSeoCaps',
    ]) {
      expect(readModel).toMatch(new RegExp(`function ${helper}\\b`));
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
    }

    expect(facade).toContain("from './domains/local-seo/snapshot-store.js'");
    expect(facade).toContain("from './domains/local-seo/visibility-read-model.js'");
    expect(facadeRetentionRawDays).toBe(RETENTION_RAW_DAYS);
    expect(facadeRetentionWeeklyMaxDays).toBe(RETENTION_WEEKLY_MAX_DAYS);
    expect(facadeRetentionPruneBatchSize).toBe(RETENTION_PRUNE_BATCH_SIZE);
    expect(facadeListLatestLocalVisibilitySnapshots).toBe(listLatestLocalVisibilitySnapshots);
    expect(facadeBuildLocalSeoKeywordVisibilitySummaryByKey).toBe(buildLocalSeoKeywordVisibilitySummaryByKey);
    expect(facadeBuildLocalSeoKeywordVisibilityByKey).toBe(buildLocalSeoKeywordVisibilityByKey);
    expect(facadeBuildLocalSeoKeywordVisibilityForKeyword).toBe(buildLocalSeoKeywordVisibilityForKeyword);
    expect(facadeGetLocalSeoVisibilityTrend).toBe(getLocalSeoVisibilityTrend);
    expect(facadeCountLocalVisibilitySnapshots).toBe(countLocalVisibilitySnapshots);
    expect(facadeLatestLocalSnapshotAt).toBe(latestLocalSnapshotAt);
    expect(facadeRunSnapshotRetentionPrune).toBe(runSnapshotRetentionPrune);
    expect(facadeGetLocalSeoCompetitorBrands).toBe(getLocalSeoCompetitorBrands);
    expect(facadeGetLocalSeoServiceGaps).toBe(getLocalSeoServiceGaps);
  });

  it('keeps read model and configuration write actions in domain services', () => {
    const facade = readRepoFile('server/local-seo.ts');
    const readService = readRepoFile('server/domains/local-seo/read-service.ts');
    const configurationActions = readRepoFile('server/domains/local-seo/configuration-actions.ts');
    const events = readRepoFile('server/domains/local-seo/events.ts');

    expect(readService).toMatch(/function getLocalSeoReadModel\b/);
    expect(readService).toContain('buildLocalSeoReportSummary');
    expect(readService).toContain('listLatestLocalVisibilitySnapshots');
    expect(readService).toContain('getLocalSeoVisibilityTrend');
    expect(facade).not.toMatch(/function getLocalSeoReadModel\b/);

    for (const helper of ['setPrimaryMarket', 'updateLocalSeoConfiguration']) {
      expect(configurationActions).toMatch(new RegExp(`function ${helper}\\b`));
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
    }
    expect(configurationActions).toContain('addActivity');
    expect(configurationActions).toContain('notifyLocalSeoUpdated');
    expect(events).toMatch(/function notifyLocalSeoUpdated\b/);
    expect(events).toContain('invalidateIntelligenceCache');
    expect(events).toContain('WS_EVENTS.LOCAL_SEO_UPDATED');
    expect(facade).not.toContain('notifyLocalSeoUpdated');

    expect(facade).toContain("from './domains/local-seo/read-service.js'");
    expect(facade).toContain("from './domains/local-seo/configuration-actions.js'");
    expect(facadeGetLocalSeoReadModel).toBe(getLocalSeoReadModel);
    expect(facadeSetPrimaryMarket).toBe(setPrimaryMarket);
    expect(facadeUpdateLocalSeoConfiguration).toBe(updateLocalSeoConfiguration);
  });

  it('keeps provider refresh and location backfill runners out of the facade', () => {
    const facade = readRepoFile('server/local-seo.ts');
    const refreshRunner = readRepoFile('server/domains/local-seo/refresh-runner.ts');

    for (const helper of [
      'resolveLocalSeoProviderLocation',
      'runLocalSeoRefreshJob',
      'runLocationBackfillJob',
    ]) {
      expect(refreshRunner).toMatch(new RegExp(`function ${helper}\\b`));
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
    }

    for (const movedDetail of [
      'resolveLocalVisibilityProvider',
      'resolveLocalLocationProvider',
      'waitForMemoryHeadroom',
      'LOCAL_SEO_REFRESH_CONCURRENCY',
      'LOCAL_SEO_REFRESH_PROGRESS_BROADCAST_INTERVAL',
      'LOCAL_SEO_LOCATION_BACKFILL_PROGRESS_BROADCAST_INTERVAL',
      'runLocalVisibilityShiftBridge',
      'runRecommendationRegen',
      'generateKeywordStrategy',
      'listLocalVisibilitySnapshotBackfillPage',
      'updateLocalVisibilitySnapshotMatches',
    ]) {
      expect(refreshRunner).toContain(movedDetail);
      expect(facade).not.toContain(movedDetail);
    }

    expect(facade).toContain("from './domains/local-seo/refresh-runner.js'");
    expect(facadeResolveLocalSeoProviderLocation).toBe(resolveLocalSeoProviderLocation);
    expect(facadeRunLocalSeoRefreshJob).toBe(runLocalSeoRefreshJob);
    expect(facadeRunLocationBackfillJob).toBe(runLocationBackfillJob);
  });
});
