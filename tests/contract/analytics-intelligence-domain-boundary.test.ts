import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  capWithDiversity as facadeCapWithDiversity,
  computeCannibalizationInsights as facadeComputeCannibalizationInsights,
  computeCtrOpportunities as facadeComputeCtrOpportunities,
  computeFreshnessAlerts as facadeComputeFreshnessAlerts,
  computePageHealthScores as facadeComputePageHealthScores,
  deduplicatePages as facadeDeduplicatePages,
  getOrComputeInsights as facadeGetOrComputeInsights,
  isStale as facadeIsStale,
  normalizePageUrlWithOrigin as facadeNormalizePageUrlWithOrigin,
  pickWeaker as facadePickWeaker,
  refreshContentDecayInsights as facadeRefreshContentDecayInsights,
  validateInsightBatch as facadeValidateInsightBatch,
} from '../../server/analytics-intelligence.js';
import {
  computeCannibalizationInsights,
  computeCtrOpportunities,
  computeFreshnessAlerts,
  computePageHealthScores,
  isStale,
} from '../../server/domains/analytics-intelligence/computations.js';
import { refreshContentDecayInsights } from '../../server/domains/analytics-intelligence/content-decay-refresh.js';
import { capWithDiversity } from '../../server/domains/analytics-intelligence/feed.js';
import {
  deduplicatePages,
  normalizePageUrlWithOrigin,
} from '../../server/domains/analytics-intelligence/normalization.js';
import { getOrComputeInsights } from '../../server/domains/analytics-intelligence/orchestrator.js';
import {
  pickWeaker,
  validateInsightBatch,
} from '../../server/domains/analytics-intelligence/validation.js';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8'); // readFile-ok - source contract checks analytics intelligence facade/domain ownership.
}

function listServerProductionFiles(dir = 'server'): string[] {
  const entries = readdirSync(new URL(`${dir}/`, repoRoot), { withFileTypes: true }); // readdir-ok - source contract checks analytics intelligence facade/domain ownership.
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

describe('analytics intelligence domain boundary', () => {
  it('keeps analytics-intelligence.ts as a compatibility facade', () => {
    const facade = readRepoFile('server/analytics-intelligence.ts');

    expect(facade).toContain("from './domains/analytics-intelligence/normalization.js'");
    expect(facade).toContain("from './domains/analytics-intelligence/computations.js'");
    expect(facade).toContain("from './domains/analytics-intelligence/orchestrator.js'");
    expect(facade).toContain("from './domains/analytics-intelligence/content-decay-refresh.js'");
    expect(facade).toContain("from './domains/analytics-intelligence/validation.js'");
    expect(facade).not.toMatch(/export function compute\w+/);
    expect(facade).not.toMatch(/async function computeAndPersistInsights\b/);
    expect(facade.split('\n').length).toBeLessThan(80);
  });

  it('keeps facade exports identity-equal to their domain owners', () => {
    expect(facadeNormalizePageUrlWithOrigin).toBe(normalizePageUrlWithOrigin);
    expect(facadeDeduplicatePages).toBe(deduplicatePages);
    expect(facadeComputePageHealthScores).toBe(computePageHealthScores);
    expect(facadeComputeCannibalizationInsights).toBe(computeCannibalizationInsights);
    expect(facadeComputeFreshnessAlerts).toBe(computeFreshnessAlerts);
    expect(facadeComputeCtrOpportunities).toBe(computeCtrOpportunities);
    expect(facadeIsStale).toBe(isStale);
    expect(facadeCapWithDiversity).toBe(capWithDiversity);
    expect(facadeGetOrComputeInsights).toBe(getOrComputeInsights);
    expect(facadeRefreshContentDecayInsights).toBe(refreshContentDecayInsights);
    expect(facadePickWeaker).toBe(pickWeaker);
    expect(facadeValidateInsightBatch).toBe(validateInsightBatch);
  });

  it('keeps production runtime consumers on domain modules instead of the facade', () => {
    const offenders = listServerProductionFiles()
      .filter((file) => file !== 'server/analytics-intelligence.ts')
      .flatMap((file) => {
        const source = readRepoFile(file);
        const imports = [...source.matchAll(/from\s+['"]([^'"]*analytics-intelligence\.js)['"]/g)];
        return imports.map((match) => `${file}: ${match[1]}`);
      });

    expect(offenders).toEqual([]);

    expect(readRepoFile('server/routes/content-decay.ts')).toContain(
      "from '../domains/analytics-intelligence/content-decay-refresh.js'",
    );
    expect(readRepoFile('server/routes/public-analytics.ts')).toContain(
      "from '../domains/analytics-intelligence/orchestrator.js'",
    );
    expect(readRepoFile('server/intelligence-recompute-job.ts')).toContain(
      "const orchestratorPath = './domains/analytics-intelligence/orchestrator.js'",
    );
    expect(readRepoFile('server/insight-recompute-cron.ts')).toContain(
      "from './domains/analytics-intelligence/computations.js'",
    );
  });
});
