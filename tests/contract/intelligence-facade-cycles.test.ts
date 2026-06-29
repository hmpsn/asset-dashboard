import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readProjectFile } from '../helpers/source-contracts.js';
import {
  canAssembleIntelligenceSlice,
  INTELLIGENCE_SLICE_METADATA_REGISTRY,
} from '../../server/intelligence/slice-metadata-registry.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const serverRoot = path.join(repoRoot, 'server');
const sliceModules = [
  'brand-slice',
  'client-signals-slice',
  'content-pipeline-slice',
  'eeat-assets-slice',
  'entity-resolution-slice',
  'generation-quality-slice',
  'insights-slice',
  'learnings-slice',
  'local-seo-slice',
  'operational-slice',
  'page-elements-slice',
  'page-profile-slice',
  'seo-context-slice',
  'site-health-slice',
  'site-inventory-slice',
] as const;

function listServerTsFiles(dir = serverRoot): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listServerTsFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

describe('intelligence facade cycle guardrails', () => {
  it('keeps invalidation and persona formatting helpers in leaf modules, not the facade body', () => {
    const facade = readProjectFile('server/workspace-intelligence.ts');

    expect(facade).toContain("export { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';");
    expect(facade).toContain("export { formatPersonasForPrompt } from './intelligence/persona-format.js';");
    expect(facade).not.toContain('function invalidateIntelligenceCache');
    expect(facade).not.toContain('function formatPersonasForPrompt');
  });

  it('prevents production imports of invalidation/persona helpers from the workspace intelligence facade', () => {
    const forbiddenFacadeHelperImport = /import\s*\{[^}]*\b(?:invalidateIntelligenceCache|formatPersonasForPrompt)\b[^}]*\}\s*from\s*['"][^'"]*workspace-intelligence\.js['"]/s;
    const offenders = listServerTsFiles()
      .filter(file => !file.endsWith('server/workspace-intelligence.ts'))
      .filter(file => forbiddenFacadeHelperImport.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(repoRoot, file).replaceAll(path.sep, '/'));

    expect(offenders).toEqual([]);
  });

  it('lazy-loads slice assemblers instead of importing every slice at registry load time', () => {
    const registry = readProjectFile('server/intelligence/slice-metadata-registry.ts');

    for (const moduleName of sliceModules) {
      expect(registry).not.toContain(`from './${moduleName}.js'`);
      expect(registry).toContain(`import('./${moduleName}.js')`);
    }
  });

  it('preserves required option gating for page and site scoped slices', () => {
    expect(canAssembleIntelligenceSlice(INTELLIGENCE_SLICE_METADATA_REGISTRY.pageProfile, {})).toBe(false);
    expect(canAssembleIntelligenceSlice(INTELLIGENCE_SLICE_METADATA_REGISTRY.pageProfile, { pagePath: '/services' })).toBe(true);
    expect(canAssembleIntelligenceSlice(INTELLIGENCE_SLICE_METADATA_REGISTRY.siteInventory, { siteId: 'site-1' })).toBe(false);
    expect(canAssembleIntelligenceSlice(INTELLIGENCE_SLICE_METADATA_REGISTRY.siteInventory, { siteId: 'site-1', siteBaseUrl: 'https://example.com' })).toBe(true);
  });
});
