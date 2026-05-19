import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type ConsumerClass = 'native' | 'hybrid' | 'legacy';

const ROOT_DIR = resolve(import.meta.dirname, '../..');
const SERVER_DIR = resolve(ROOT_DIR, 'server');
const AUDIT_DOC = resolve(ROOT_DIR, 'docs/superpowers/audits/2026-05-18-intelligence-consumer-consolidation-audit.md');
const MANUAL_CONSUMERS = new Set([
  'server/admin-chat-context.ts',
  'server/routes/content-briefs.ts',
]);
const FALSE_POSITIVE_FILES = new Set([
  'server/anomaly-detection.ts',
]);

const INVENTORY: Array<{
  file: string;
  classification: ConsumerClass;
  targetPath: 'low-level' | 'content-builder' | 'recommendation-builder' | 'future-chat-builder' | 'future-briefing-builder' | 'future-page-assist-builder';
}> = [
  { file: 'server/aeo-page-review.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/admin-chat-context.ts', classification: 'hybrid', targetPath: 'future-chat-builder' },
  { file: 'server/blueprint-generator.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/brand-identity.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/brandscript.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/content-brief.ts', classification: 'legacy', targetPath: 'content-builder' },
  { file: 'server/content-decay.ts', classification: 'hybrid', targetPath: 'recommendation-builder' },
  { file: 'server/content-posts-ai.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/copy-generation.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/diagnostic-orchestrator.ts', classification: 'hybrid', targetPath: 'future-chat-builder' },
  { file: 'server/discovery-ingestion.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/internal-links.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/keyword-recommendations.ts', classification: 'hybrid', targetPath: 'recommendation-builder' },
  { file: 'server/keyword-strategy-ai-synthesis.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/meeting-brief-generator.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/monthly-digest.ts', classification: 'legacy', targetPath: 'future-briefing-builder' },
  { file: 'server/page-analysis-job.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/routes/content-briefs.ts', classification: 'legacy', targetPath: 'content-builder' },
  { file: 'server/routes/content-posts.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/routes/google.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/routes/jobs.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/routes/public-analytics.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/routes/rewrite-chat.ts', classification: 'native', targetPath: 'future-page-assist-builder' },
  { file: 'server/routes/webflow-keywords.ts', classification: 'native', targetPath: 'future-page-assist-builder' },
  { file: 'server/routes/webflow-seo-bulk-rewrite.ts', classification: 'native', targetPath: 'future-page-assist-builder' },
  { file: 'server/routes/webflow-seo-page-tools.ts', classification: 'native', targetPath: 'future-page-assist-builder' },
  { file: 'server/routes/webflow-seo-rewrite.ts', classification: 'native', targetPath: 'future-page-assist-builder' },
  { file: 'server/routes/workspaces.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/seo-audit-ai-recs.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/voice-calibration.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/webflow-seo-bulk-analyze-job.ts', classification: 'native', targetPath: 'low-level' },
  { file: 'server/webflow-seo-bulk-rewrite-job.ts', classification: 'native', targetPath: 'low-level' },
];

function listTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function isGenerationConsumer(relPath: string, source: string): boolean {
  const hasIntelligenceAccess = /buildWorkspaceIntelligence\(|buildIntelPrompt\(|formatForPrompt\(|getWorkspaceLearnings\(|formatLearningsForPrompt\(|getInsights\(/.test(source);
  const hasAiCall = /callAI\(|callCreativeAI\(|callAnthropic\(|callOpenAI\(/.test(source);
  return hasIntelligenceAccess && (hasAiCall || MANUAL_CONSUMERS.has(relPath));
}

function countByClassification() {
  return INVENTORY.reduce<Record<ConsumerClass, number>>((acc, entry) => {
    acc[entry.classification] += 1;
    return acc;
  }, { native: 0, hybrid: 0, legacy: 0 });
}

function parseAuditSummary(source: string): Record<ConsumerClass, number> {
  const native = source.match(/- `native`: (\d+)/);
  const hybrid = source.match(/- `hybrid`: (\d+)/);
  const legacy = source.match(/- `legacy`: (\d+)/);
  expect(native).not.toBeNull();
  expect(hybrid).not.toBeNull();
  expect(legacy).not.toBeNull();
  return {
    native: Number(native?.[1] ?? 0),
    hybrid: Number(hybrid?.[1] ?? 0),
    legacy: Number(legacy?.[1] ?? 0),
  };
}

describe('intelligence consumer inventory', () => {
  it('uses unique classifications for real server files', () => {
    const seen = new Set<string>();
    for (const entry of INVENTORY) {
      expect(existsSync(resolve(ROOT_DIR, entry.file))).toBe(true);
      expect(seen.has(entry.file)).toBe(false);
      seen.add(entry.file);
    }
  });

  it('classifies every current server-side AI/recommendation intelligence consumer', () => {
    const classifiedFiles = INVENTORY.map(entry => entry.file).sort();
    const discoveredFiles = listTypeScriptFiles(SERVER_DIR)
      .map(file => relative(ROOT_DIR, file).replaceAll('\\', '/'))
      .filter(relPath => {
        if (FALSE_POSITIVE_FILES.has(relPath)) return false;
        const source = readFileSync(resolve(ROOT_DIR, relPath), 'utf-8'); // readFile-ok — inventory guard: scans server AI/recommendation consumers so new intelligence-context callsites must be explicitly classified as native/hybrid/legacy.
        return isGenerationConsumer(relPath, source);
      })
      .sort();

    expect(discoveredFiles).toEqual(classifiedFiles);
  });

  it('keeps the published audit summary in sync with the inventory counts', () => {
    const auditSource = readFileSync(AUDIT_DOC, 'utf-8'); // readFile-ok — audit guard: the published intelligence-consumer audit is declared source-of-truth, so this test keeps its native/hybrid/legacy counts synchronized with the inventory contract.
    expect(parseAuditSummary(auditSource)).toEqual(countByClassification());
  });
});
