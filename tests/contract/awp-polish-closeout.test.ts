import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(filePath: string): string {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

describe('AWP polish closeout contracts', () => {
  it('keeps Strategy settings active controls teal and stateful', () => {
    const source = readRepoFile('src/components/strategy/StrategySettings.tsx');

    expect(source).toContain('aria-expanded={settingsOpen}');
    expect(source).toContain('role="group" aria-label="SEO data mode"');
    expect(source).toContain('role="group" aria-label="Page analysis limit"');
    expect(source).toContain('aria-pressed={seoDataMode === mode}');
    expect(source).toContain('aria-pressed={maxPages === cap}');
    expect(source).not.toContain('role="radio"');
    expect(source).not.toContain('aria-checked=');
    expect(source).not.toContain('text-accent-orange');
    expect(source).not.toContain('border-orange-500/50 bg-orange-500/10');
    expect(source).not.toContain('bg-orange-500/10 border border-orange-500/20');
  });

  it('keeps strategy archetype polish inside approved hue families', () => {
    const stanceBar = readRepoFile('src/components/strategy/issue/StanceBar.tsx');
    const archetypeMap = readRepoFile('src/lib/recArchetypeMap.ts');
    const howItWorks = readRepoFile('src/components/strategy/StrategyHowItWorks.tsx');

    expect(stanceBar).not.toContain('sky-');
    expect(stanceBar).not.toContain('purple');
    expect(archetypeMap).not.toContain('sky-');
    expect(howItWorks).not.toContain('text-accent-orange');
    expect(stanceBar).toContain("{ id: 'demand', label: 'Win demand', background: 'var(--teal)' }");
    expect(stanceBar).toContain("{ id: 'protect', label: 'Protect', background: 'var(--emerald)' }");
    expect(stanceBar).toContain("{ id: 'technical', label: 'Technical', background: 'var(--blue)' }");
    expect(stanceBar).toContain("{ id: 'local', label: 'Local', background: 'var(--orange)' }");
    expect(archetypeMap).toContain("technical: 'bg-blue-300'");
  });

  it('keeps Strategy diff disclosure state visible to assistive tech', () => {
    const source = readRepoFile('src/components/strategy/StrategyDiff.tsx');

    expect(source).toContain('aria-expanded={expanded}');
  });

  it('keeps the Schema workflow guide free of stale dead-end instructions', () => {
    const source = readRepoFile('src/components/schema/SchemaWorkflowGuide.tsx');

    expect(source).toContain('Generate Site Plan');
    expect(source).not.toContain('Generate Schema Plan');
    expect(source).not.toContain('Save to Snapshot');
    expect(source).not.toContain('Competitors tab');
    expect(source).not.toContain('coverage dashboard');
    expect(source).not.toContain('Priority queue');
    expect(source).not.toContain('collapsible, below the main view');
  });

  it('prevents the Schema generator hero from flashing over hydrating snapshots', () => {
    const component = readRepoFile('src/components/SchemaSuggester.tsx');
    const hook = readRepoFile('src/components/schema/useSchemaSuggesterGeneration.ts');

    expect(hook).toContain('isLoading: snapshotLoading');
    expect(hook).toContain('snapshotLoading');
    expect(component).toContain('if (!started && snapshotLoading)');
    expect(component).toContain('Checking saved schema results');
  });

  it('keeps local SEO primary-market mutations invalidating every dependent read surface', () => {
    const source = readRepoFile('src/hooks/admin/useLocalSeo.ts');

    const useSetPrimaryMarket = source.slice(source.indexOf('export function useSetPrimaryMarket'));
    expect(useSetPrimaryMarket).toContain('queryKeys.admin.localSeo(workspaceId)');
    expect(useSetPrimaryMarket).toContain('queryKeys.admin.keywordCommandCenter(workspaceId)');
    expect(useSetPrimaryMarket).toContain('queryKeys.admin.keywordStrategy(workspaceId)');
    expect(useSetPrimaryMarket).toContain('queryKeys.admin.intelligenceAll(workspaceId)');
  });

  it('keeps local SEO cost and fallback-market assumptions centralized', () => {
    const shared = readRepoFile('shared/types/local-seo.ts');
    const drawer = readRepoFile('src/components/local-seo/LocalSeoMarketSetupDrawer.tsx');
    const service = readRepoFile('server/domains/local-seo/configuration-service.ts');

    expect(shared).toContain('LOCAL_SEO_DATAFORSEO_KEYWORD_COST_USD');
    expect(drawer).toContain('LOCAL_SEO_DATAFORSEO_KEYWORD_COST_USD');
    expect(drawer).not.toContain('* 0.002');
    expect(service).toContain('ORDER BY label COLLATE NOCASE ASC, id ASC LIMIT 1');
  });

  it('keeps provider-degraded local SEO refreshes visible in the stat grid', () => {
    const panel = readRepoFile('src/components/local-seo/LocalSeoVisibilityPanel.tsx');

    expect(panel).toContain('report.degradedCount > 0');
    expect(panel).toContain('label="Degraded"');
    expect(panel).toContain('value={report.degradedCount}');
    expect(panel).toContain('sub="provider warnings"');
  });

  it('does not reintroduce stale seo-generation-quality flag comments in strategy synthesis modules', () => {
    for (const filePath of [
      'server/keyword-strategy-context.ts',
      'server/keyword-strategy-enrichment.ts',
      'server/keyword-strategy-universe.ts',
    ]) {
      expect(readRepoFile(filePath), filePath).not.toContain('seo-generation-quality');
    }
  });
});
