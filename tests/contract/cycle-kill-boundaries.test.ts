import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function readSource(path: string): string {
  return readFileSync(path, 'utf-8'); // readFile-ok - source contract guard for cycle-kill boundaries.
}

describe('cycle-kill boundary contracts', () => {
  it('keeps impact-band as the leaf owner of the client-safe impact band type', () => {
    const impactBandSource = readSource('shared/types/impact-band.ts');
    const fixCatalogSource = readSource('shared/types/fix-catalog.ts');

    expect(impactBandSource).toContain('export interface ImpactBand');
    expect(impactBandSource).not.toContain('./fix-catalog');
    expect(fixCatalogSource).toContain("export type { ImpactBand } from './impact-band.js'");
  });

  it('keeps briefing templates off their registry barrel', () => {
    const dir = 'server/briefing-templates';
    const templateFiles = readdirSync(dir)
      .filter((file) => file.endsWith('.ts') && !['index.ts', 'context.ts'].includes(file));

    expect(templateFiles.length).toBeGreaterThan(0);
    for (const file of templateFiles) {
      const source = readSource(join(dir, file));
      expect(source).not.toContain("from './index.js'");
      if (/import type \{ TemplateContext \}/.test(source)) {
        expect(source).toContain("from './context.js'");
      }
    }
  });

  it('keeps audit suppression projection below the reports store', () => {
    const reportsSource = readSource('server/reports.ts');
    const viewsSource = readSource('server/audit-snapshot-views.ts');

    expect(reportsSource).toContain("from './audit-suppression-projection.js'");
    expect(reportsSource).not.toContain("from './audit-snapshot-views.js'");
    expect(viewsSource).toContain("from './reports.js'");
  });

  it('keeps schema data extraction independent from template helpers', () => {
    const dataSourcesSource = readSource('server/schema/data-sources.ts');
    const helpersSource = readSource('server/schema/templates/helpers.ts');
    const sanitizerSource = readSource('server/schema/schema-text-sanitizer.ts');

    expect(dataSourcesSource).toContain("from './schema-text-sanitizer.js'");
    expect(dataSourcesSource).not.toContain("from './templates/helpers.js'");
    expect(helpersSource).toContain("export { scrubBrandSuffix } from '../schema-text-sanitizer.js'");
    expect(sanitizerSource).toContain('export function scrubBrandSuffix');
  });

  it('keeps small frontend cycles on leaf type modules', () => {
    const healthModelSource = readSource('src/components/client/health-tab/healthTabModel.ts');
    const cockpitRowSource = readSource('src/components/strategy/CockpitRow.tsx');
    const backingQueueSource = readSource('src/components/strategy/issue/BackingMovesQueue.tsx');
    const strategyCockpitSource = readSource('src/components/strategy/StrategyCockpit.tsx');

    expect(healthModelSource).toContain("from './healthTabTypes'");
    expect(healthModelSource).not.toContain("from './useHealthTabShell'");
    expect(cockpitRowSource).toContain("from './cockpitTypes'");
    expect(cockpitRowSource).not.toContain("from './StrategyCockpit'");
    expect(backingQueueSource).toContain("from '../cockpitTypes'");
    expect(strategyCockpitSource).toContain("export type { CockpitActions } from './cockpitTypes'");
  });

  it('keeps admin fix context on a leaf type module instead of App.tsx', () => {
    const appSource = readSource('src/App.tsx');
    const fixContextSource = readSource('src/types/fix-context.ts');
    const consumers = [
      'src/components/ContentBriefs.tsx',
      'src/components/ContentPipeline.tsx',
      'src/components/PageIntelligence.tsx',
      'src/components/SchemaSuggester.tsx',
      'src/components/SeoEditor.tsx',
      'src/components/SeoEditorWrapper.tsx',
      'src/components/editor/useSeoEditorSessionState.ts',
    ];

    expect(fixContextSource).toContain('export interface FixContext');
    expect(appSource).not.toContain('export interface FixContext');
    expect(appSource).toContain("from './types/fix-context'");
    for (const file of consumers) {
      const source = readSource(file);
      expect(source).toContain('types/fix-context');
      expect(source).not.toMatch(/from ['"](?:\.\.\/)+App['"]/);
    }
  });

  it('keeps cycle-sensitive local SEO consumers off the broad facade', () => {
    const consumers = [
      'server/keyword-strategy-ai-synthesis.ts',
      'server/keyword-strategy-universe.ts',
      'server/keyword-strategy-enrichment.ts',
      'server/keyword-strategy-synthesis/context.ts',
      'server/seo-target-geo.ts',
      'server/intelligence/seo-context-slice.ts',
      'server/domains/keyword-command-center/source-snapshot.ts',
      'server/domains/keyword-command-center/detail-service.ts',
      'server/domains/keyword-command-center/rows-service.ts',
      'server/domains/keyword-command-center/summary-service.ts',
    ];

    for (const file of consumers) {
      const source = readSource(file);
      expect(source).not.toMatch(/from ['"](?:\.\.?\/)+local-seo\.js['"]/);
    }
  });

  it('keeps local SEO intelligence assembly on the narrow read boundary', () => {
    const slice = readSource('server/intelligence/local-seo-slice.ts');
    const readModel = readSource('server/domains/local-seo/intelligence-read-model.ts');

    expect(readModel).toContain('export async function loadLocalSeoIntelligenceInputs');
    expect(slice).toContain("import('../domains/local-seo/intelligence-read-model.js')");
    expect(slice).not.toContain("from '../local-seo.js'");
    expect(slice).not.toContain("import('../local-seo.js')");

    for (const forbidden of [
      './refresh-runner.js',
      './configuration-actions.js',
      '../../local-seo.js',
      '../../routes/local-seo.js',
      '../../providers/',
      'runLocalSeoRefreshJob',
      'runLocationBackfillJob',
    ]) {
      expect(readModel).not.toContain(forbidden);
    }
  });

  it('keeps schema template type resolution in a schema leaf utility', () => {
    const templateTypes = readSource('server/schema/template-schema-types.ts');
    const matrices = readSource('server/content-matrices.ts');
    const templates = readSource('server/content-templates.ts');
    const queue = readSource('server/schema-queue.ts');

    expect(templateTypes).toContain('export function getSchemaTypesForTemplate');
    expect(templateTypes).toContain("from './role-type-registry.js'");
    expect(matrices).not.toContain("from './schema-suggester.js'");
    expect(matrices).toContain("export { getSchemaTypesForTemplate } from './schema/template-schema-types.js'");
    expect(templates).toContain("from './schema/template-schema-types.js'");
    expect(queue).toContain("from './schema/template-schema-types.js'");
  });

  it('keeps CWV helper modules off the SEO audit orchestrator for types', () => {
    const cwvTypes = readSource('server/seo-audit-cwv-types.ts');
    const cwv = readSource('server/seo-audit-cwv.ts');
    const siteChecks = readSource('server/seo-audit-site-checks.ts');
    const audit = readSource('server/seo-audit.ts');

    expect(cwvTypes).toContain('export interface CwvSummary');
    expect(cwv).toContain("from './seo-audit-cwv-types.js'");
    expect(siteChecks).toContain("from './seo-audit-cwv-types.js'");
    expect(cwv).not.toContain("from './seo-audit.js'");
    expect(siteChecks).not.toContain("from './seo-audit.js'");
    expect(audit).toContain("export type { CwvMetricSummary, CwvStrategyResult, CwvSummary } from './seo-audit-cwv-types.js'");
  });

  it('keeps generation intelligence slices on read/type leaves for content status data', () => {
    const contentPipeline = readSource('server/intelligence/content-pipeline-slice.ts');
    const pageProfile = readSource('server/intelligence/page-profile-slice.ts');
    const briefReadModel = readSource('server/content-brief-read-model.ts');
    const decayReadModel = readSource('server/content-decay-read-model.ts');
    const briefFacade = readSource('server/content-brief.ts');
    const decayFacade = readSource('server/content-decay.ts');

    expect(briefReadModel).toContain('export function listBriefs');
    expect(briefReadModel).toContain('export function getBrief');
    expect(decayReadModel).toContain('export function loadDecayAnalysis');
    expect(briefFacade).toContain("from './content-brief-read-model.js'");
    expect(decayFacade).toContain("export { loadDecayAnalysis } from './content-decay-read-model.js'");

    for (const source of [contentPipeline, pageProfile]) {
      expect(source).toContain('content-brief-read-model.js');
      expect(source).toContain('content-decay-read-model.js');
      expect(source).not.toContain("import('../content-brief.js')");
      expect(source).not.toContain("import('../content-decay.js')");
      expect(source).not.toContain("from '../content-decay.js'");
    }
  });

  it('keeps internal-link result contracts in shared types', () => {
    const sharedTypes = readSource('shared/types/internal-links.ts');
    const internalLinks = readSource('server/internal-links.ts');
    const internalLinksUi = readSource('src/components/InternalLinks.tsx');
    const pageProfile = readSource('server/intelligence/page-profile-slice.ts');
    const siteArchitecture = readSource('server/routes/site-architecture.ts');

    expect(sharedTypes).toContain('export interface InternalLinkResult');
    expect(internalLinks).toContain("from '../shared/types/internal-links.js'");
    expect(internalLinks).toContain("export type {\n  InternalLinkResult");
    expect(pageProfile).toContain("from '../../shared/types/internal-links.js'");
    expect(siteArchitecture).toContain("from '../../shared/types/internal-links.js'");
    expect(internalLinksUi).toContain("from '../../shared/types/internal-links'");
    expect(internalLinksUi).not.toContain('interface InternalLinkResult');
    expect(internalLinksUi).not.toContain('interface LinkSuggestion');
    expect(internalLinksUi).not.toContain('interface PageLinkHealth');
    expect(pageProfile).not.toContain("import('../internal-links.js').InternalLinkResult");
    expect(siteArchitecture).not.toContain("from '../internal-links.js'");
  });

  it('keeps brand-slice reads on leaf modules (no brand-identity facade import)', () => {
    const brandSlice = readSource('server/intelligence/brand-slice.ts');
    expect(brandSlice).toContain("from '../brand-deliverable-read-model.js'");
    expect(brandSlice).not.toContain("from '../brand-identity.js'");
    // Layer-2 voice DNA renders come from the cycle-safe leaf, NEVER from the
    // cycle-heavy voice-calibration facade (which would reintroduce a hard cycle).
    expect(brandSlice).toContain("from '../voice-dna-layer2.js'");
    expect(brandSlice).not.toContain("from '../voice-calibration.js'");
  });

  it('keeps voice profile reads on a leaf read model for intelligence context', () => {
    const voiceReadModel = readSource('server/voice-profile-read-model.ts');
    const voiceCalibration = readSource('server/voice-calibration.ts');
    const seoContextSource = readSource('server/intelligence/seo-context-source.ts');

    expect(voiceReadModel).toContain('export function getVoiceProfile');
    expect(voiceCalibration).toContain("export { getVoiceProfile } from './voice-profile-read-model.js'");
    expect(seoContextSource).toContain("from '../voice-profile-read-model.js'");
    expect(seoContextSource).not.toContain("from '../voice-calibration.js'");
  });

  it('keeps generation context prompt helpers off broad compatibility facades where possible', () => {
    const generationContext = readSource('server/intelligence/generation-context-builders.ts');
    const contentBrief = readSource('server/content-brief.ts');
    const contentPostsAi = readSource('server/content-posts-ai.ts');

    expect(generationContext).toContain("from './formatters.js'");
    expect(generationContext).toContain("from '../domains/local-seo/configuration-service.js'");
    expect(generationContext).not.toContain("from '../local-seo.js'");
    expect(contentBrief).toContain("from './intelligence/formatters.js'");
    expect(contentBrief).not.toContain("from './workspace-intelligence.js'");
    expect(contentPostsAi).toContain("from '../shared/types/content.js'");
    expect(contentPostsAi).not.toContain("from './content-brief.js'");
  });

  it('keeps content brief generation from statically importing workspace intelligence builders', () => {
    const contentBrief = readSource('server/content-brief.ts');

    expect(contentBrief).toContain("intelligenceModulePath('generation-context-builders')");
    expect(contentBrief).not.toContain("from './intelligence/generation-context-builders.js'");
  });

  it('keeps keyword synthesis context off the public synthesis facade static import path', () => {
    const synthesisFacade = readSource('server/keyword-strategy-ai-synthesis.ts');

    expect(synthesisFacade).toContain("synthesisModulePath('context')");
    expect(synthesisFacade).not.toContain("from './keyword-strategy-synthesis/context.js'");
  });

  it('keeps schema suggestion contracts on schema leaf types', () => {
    const typeLeaf = readSource('server/schema/suggestion-types.ts');
    const schemaStore = readSource('server/schema-store.ts');
    const serializer = readSource('server/serializers/client-safe.ts');
    const graphValidator = readSource('server/schema/whole-site-graph-validator.ts');
    const contextBuilder = readSource('server/schema/context-builder.ts');
    const generationJob = readSource('server/schema-generation-job.ts');
    const suggester = readSource('server/schema-suggester.ts');

    expect(typeLeaf).toContain('export interface SchemaPageSuggestion');
    expect(typeLeaf).toContain('export interface SchemaContext');
    for (const source of [schemaStore, serializer, graphValidator, contextBuilder, generationJob]) {
      expect(source).toContain('suggestion-types.js');
      expect(source).not.toContain("type SchemaPageSuggestion } from './schema-suggester.js'");
      expect(source).not.toContain("type SchemaPageSuggestion } from '../schema-suggester.js'");
    }
    for (const source of [schemaStore, serializer, graphValidator, contextBuilder]) {
      expect(source).not.toContain("from './schema-suggester.js'");
      expect(source).not.toContain("from '../schema-suggester.js'");
    }
    expect(suggester).toContain("export type { SchemaContext, SchemaPageSuggestion, SchemaSuggestion } from './schema/suggestion-types.js'");
  });

  it('keeps schema queue reads below the content matrix CRUD module', () => {
    const readModel = readSource('server/content-matrix-read-model.ts');
    const matrices = readSource('server/content-matrices.ts');
    const queue = readSource('server/schema-queue.ts');

    expect(readModel).toContain('export function getMatrix');
    expect(readModel).toContain('export function listMatrices');
    expect(matrices).toContain("from './content-matrix-read-model.js'");
    expect(queue).toContain("from './content-matrix-read-model.js'");
    expect(queue).not.toContain("from './content-matrices.js'");
  });

  it('keeps inbox adapter source propagation off static mutation/lifecycle imports', () => {
    const clientActionShared = readSource('server/domains/inbox/deliverable-adapters/client-action-shared.ts');
    const approvalBatchShared = readSource('server/domains/inbox/deliverable-adapters/approval-batch-shared.ts');
    const schemaPlanAdapter = readSource('server/domains/inbox/deliverable-adapters/schema-plan.ts');
    const approvalRespond = readSource('server/domains/inbox/approval-batch-respond.ts');
    const approvalItemRespond = readSource('server/domains/inbox/approval-batch-item-respond.ts');
    const dualWrite = readSource('server/domains/inbox/approval-batch-dual-write.ts');
    const mirrorSync = readSource('server/domains/inbox/approval-batch-mirror-sync.ts');

    expect(clientActionShared).toContain("inboxDomainModulePath('client-actions-mutations')");
    expect(clientActionShared).not.toContain("import('../client-actions-mutations.js')");
    expect(approvalBatchShared).toContain("inboxDomainModulePath('approval-batch-response-lifecycle')");
    expect(approvalBatchShared).not.toContain("from '../approval-batch-response-lifecycle.js'");
    expect(schemaPlanAdapter).toContain("schemaDomainModulePath('schema-plan-feedback')");
    expect(schemaPlanAdapter).not.toContain("from '../../schema/schema-plan-feedback.js'");
    expect(approvalRespond).toContain("from './approval-batch-mirror-sync.js'");
    expect(approvalItemRespond).toContain("from './approval-batch-mirror-sync.js'");
    expect(dualWrite).toContain("from './approval-batch-mirror-sync.js'");
    expect(mirrorSync).not.toContain("from './deliverable-adapters/index.js'");
  });

  it('keeps intelligence slices from statically importing cycle-heavy optional read paths', () => {
    const seoContext = readSource('server/intelligence/seo-context-slice.ts');
    const siteHealth = readSource('server/intelligence/site-health-slice.ts');
    const pageProfile = readSource('server/intelligence/page-profile-slice.ts');
    const resolutionService = readSource('server/domains/recommendations/resolution-service.ts');

    expect(seoContext).toContain("serverModulePath('keyword-strategy-assembler')");
    expect(seoContext).not.toContain("import('../keyword-strategy-assembler.js')");
    expect(siteHealth).toContain("serverModulePath('audit-snapshot-views')");
    expect(siteHealth).toContain("serverModulePath('anomaly-detection')");
    expect(siteHealth).toContain("serverModulePath('workspace-metrics-snapshots')");
    expect(siteHealth).not.toContain("from '../seo-audit.js'");
    expect(siteHealth).not.toContain("import('../audit-snapshot-views.js')");
    expect(siteHealth).not.toContain("import('../anomaly-detection.js')");
    expect(siteHealth).not.toContain("import('../workspace-metrics-snapshots.js')");
    expect(pageProfile).toContain("serverModulePath('audit-snapshot-views')");
    expect(pageProfile).not.toContain("import('../audit-snapshot-views.js')");
    expect(resolutionService).toContain("from '../../scoring/opportunity-regen.js'");
    expect(readSource('server/scoring/opportunity-regen.ts')).not.toContain("from '../recommendation-regen-scheduler.js'");
  });
});
