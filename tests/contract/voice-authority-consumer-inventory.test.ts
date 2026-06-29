import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type VoiceAuthorityClass = 'correct' | 'builder-backed' | 'drift' | 'documented-exception';

const ROOT_DIR = resolve(import.meta.dirname, '../..');
const SERVER_DIR = resolve(ROOT_DIR, 'server');
const AUDIT_DOC = resolve(ROOT_DIR, 'docs/superpowers/audits/2026-05-26-voice-authority-audit.md');
const BRAND_ENGINE_RULES = resolve(ROOT_DIR, 'docs/rules/brand-engine.md');

const DISPATCHER_AND_HELPERS = new Set([
  'server/ai.ts',
  'server/anthropic-helpers.ts',
  'server/keyword-strategy-synthesis/ai-callers.ts',
  'server/narrative-ai.ts',
  'server/openai-helpers.ts',
]);

const VOICE_AUTHORITY_INVENTORY: Array<{
  file: string;
  classification: VoiceAuthorityClass;
}> = [
  { file: 'server/aeo-page-review.ts', classification: 'builder-backed' },
  { file: 'server/anomaly-detection.ts', classification: 'correct' },
  { file: 'server/blueprint-generator.ts', classification: 'documented-exception' },
  { file: 'server/brand-identity.ts', classification: 'correct' },
  { file: 'server/brandscript.ts', classification: 'correct' },
  { file: 'server/briefing-prompt.ts', classification: 'correct' },
  { file: 'server/chat-memory.ts', classification: 'documented-exception' },
  { file: 'server/content-brief.ts', classification: 'correct' },
  { file: 'server/content-decay.ts', classification: 'builder-backed' },
  { file: 'server/content-posts-ai-jobs.ts', classification: 'correct' },
  { file: 'server/content-posts-ai.ts', classification: 'correct' },
  { file: 'server/copy-generation.ts', classification: 'correct' },
  { file: 'server/copy-intelligence.ts', classification: 'documented-exception' },
  { file: 'server/copy-refresh.ts', classification: 'documented-exception' },
  { file: 'server/diagnostic-orchestrator.ts', classification: 'correct' },
  { file: 'server/discovery-ingestion.ts', classification: 'documented-exception' },
  { file: 'server/google-business-profile-review-response-ai.ts', classification: 'correct' },
  { file: 'server/internal-links.ts', classification: 'correct' },
  { file: 'server/keyword-recommendations.ts', classification: 'builder-backed' },
  { file: 'server/keyword-strategy-ai-synthesis.ts', classification: 'correct' },
  { file: 'server/llms-txt-generator.ts', classification: 'documented-exception' },
  { file: 'server/meeting-brief-generator.ts', classification: 'correct' },
  { file: 'server/strategy-pov-generator.ts', classification: 'correct' },
  { file: 'server/the-issue-lead-value-ai.ts', classification: 'documented-exception' },
  { file: 'server/monthly-digest.ts', classification: 'correct' },
  { file: 'server/page-analysis-job.ts', classification: 'documented-exception' },
  { file: 'server/schema-plan.ts', classification: 'documented-exception' },
  { file: 'server/schema/extractors/description.ts', classification: 'documented-exception' },
  { file: 'server/schema/extractors/page-elements/howto-ai-fallback.ts', classification: 'documented-exception' },
  { file: 'server/seo-audit-ai-recs.ts', classification: 'correct' },
  { file: 'server/voice-calibration.ts', classification: 'correct' },
  { file: 'server/webflow-bulk-seo-fix-background-job.ts', classification: 'correct' },
  { file: 'server/webflow-seo-bulk-analyze-job.ts', classification: 'documented-exception' },
  { file: 'server/webflow-seo-bulk-rewrite-job.ts', classification: 'correct' },
  { file: 'server/workspace-context-generation-job.ts', classification: 'documented-exception' },
  { file: 'server/routes/ai.ts', classification: 'documented-exception' },
  { file: 'server/routes/content-publish.ts', classification: 'documented-exception' },
  { file: 'server/routes/google.ts', classification: 'documented-exception' },
  { file: 'server/routes/public-analytics.ts', classification: 'documented-exception' },
  { file: 'server/routes/rewrite-chat.ts', classification: 'builder-backed' },
  { file: 'server/routes/webflow-keywords.ts', classification: 'builder-backed' },
  { file: 'server/routes/webflow-seo-bulk-rewrite.ts', classification: 'correct' },
  { file: 'server/routes/webflow-seo-page-tools.ts', classification: 'correct' },
  { file: 'server/routes/webflow-seo-rewrite.ts', classification: 'correct' },
  { file: 'server/routes/workspaces.ts', classification: 'documented-exception' },
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
    if (fullPath.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

function isAiConsumer(relPath: string, source: string): boolean {
  if (DISPATCHER_AND_HELPERS.has(relPath)) return false;
  if (relPath.includes('/__tests__/')) return false;
  return /\bcallAI\(|\bcallCreativeAI\(|\bcallAnthropic\(|\bcallOpenAI\(|\bcallKeywordStrategyAI\(|\bcallNarrativeAI\(/.test(source);
}

function countByClassification(): Record<VoiceAuthorityClass, number> {
  return VOICE_AUTHORITY_INVENTORY.reduce<Record<VoiceAuthorityClass, number>>((acc, entry) => {
    acc[entry.classification] += 1;
    return acc;
  }, { correct: 0, 'builder-backed': 0, drift: 0, 'documented-exception': 0 });
}

function parseAuditSummary(source: string): Record<VoiceAuthorityClass, number> {
  const correct = source.match(/- `correct`: (\d+)/);
  const builderBacked = source.match(/- `builder-backed`: (\d+)/);
  const drift = source.match(/- `drift`: (\d+)/);
  const documentedException = source.match(/- `documented-exception`: (\d+)/);
  expect(correct).not.toBeNull();
  expect(builderBacked).not.toBeNull();
  expect(drift).not.toBeNull();
  expect(documentedException).not.toBeNull();
  return {
    correct: Number(correct?.[1] ?? 0),
    'builder-backed': Number(builderBacked?.[1] ?? 0),
    drift: Number(drift?.[1] ?? 0),
    'documented-exception': Number(documentedException?.[1] ?? 0),
  };
}

describe('voice authority consumer inventory', () => {
  it('classifies every current server-side AI consumer for voice authority', () => {
    const classifiedFiles = VOICE_AUTHORITY_INVENTORY.map(entry => entry.file).sort();
    const discoveredFiles = listTypeScriptFiles(SERVER_DIR)
      .map(file => relative(ROOT_DIR, file).replaceAll('\\', '/'))
      .filter(relPath => {
        const source = readFileSync(resolve(ROOT_DIR, relPath), 'utf-8'); // readFile-ok - source contract scans AI callers so new voice-authority consumers must be classified.
        return isAiConsumer(relPath, source);
      })
      .sort();

    expect(discoveredFiles).toEqual(classifiedFiles);
  });

  it('keeps the published audit summary in sync with the source inventory', () => {
    const auditSource = readFileSync(AUDIT_DOC, 'utf-8'); // readFile-ok - audit contract keeps summary counts synchronized with the source inventory above.
    expect(parseAuditSummary(auditSource)).toEqual(countByClassification());
  });

  it('keeps all drift entries explicitly documented in the audit', () => {
    const auditSource = readFileSync(AUDIT_DOC, 'utf-8'); // readFile-ok - drift guard ensures PR2 migration targets cannot be implicit.
    const driftFiles = VOICE_AUTHORITY_INVENTORY
      .filter(entry => entry.classification === 'drift')
      .map(entry => entry.file);

    expect(driftFiles).toHaveLength(0);
    for (const file of driftFiles) {
      expect(auditSource).toContain(`| \`${file}\` | drift |`);
    }
  });

  it('keeps the PR2 migrated consumers on buildSystemPrompt authority', () => {
    for (const file of [
      'server/anomaly-detection.ts',
      'server/diagnostic-orchestrator.ts',
      'server/routes/webflow-seo-page-tools.ts',
    ]) {
      const source = readFileSync(resolve(ROOT_DIR, file), 'utf-8'); // readFile-ok - PR2 guard: migrated voice-authority consumers must stay on buildSystemPrompt.
      expect(source).toContain('buildSystemPrompt');
      expect(source).not.toMatch(/system:\s*['"`]You are/);
    }
  });

  it('documents the current four-layer buildSystemPrompt contract', () => {
    const rules = readFileSync(BRAND_ENGINE_RULES, 'utf-8'); // readFile-ok - docs contract guards the brand-engine prompt authority model.
    expect(rules).toContain('### Four-Layer Architecture');
    expect(rules).toContain('Layer 4');
    expect(rules).toContain('Universal prose quality rules');
    expect(rules).toContain('skipProseRules');
    expect(rules).toContain('buildSystemPrompt(workspaceId, baseInstructions, customNotes?, opts?)');
  });

  it('prevents manual voice DNA prompt assembly outside canonical brand-engine authority helpers', () => {
    const allowed = new Set([
      'server/intelligence/brand-slice.ts',
      'server/intelligence/seo-context-source.ts',
      'server/prompt-assembly.ts',
      'server/voice-calibration.ts',
      'server/voice-dna-layer2.ts',
      'server/voice-dna-render.ts',
    ]);

    const offenders = listTypeScriptFiles(SERVER_DIR)
      .map(file => relative(ROOT_DIR, file).replaceAll('\\', '/'))
      .filter(relPath => {
        if (allowed.has(relPath)) return false;
        const source = readFileSync(resolve(ROOT_DIR, relPath), 'utf-8'); // readFile-ok - voice guard: manual DNA blocks duplicate buildSystemPrompt authority unless centralized.
        return /VOICE DNA:|Voice guardrails:|guardrailsToPromptInstructions\(/.test(source);
      });

    expect(offenders).toEqual([]);
  });
});
