import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const migratedGeneralGenerationFiles: Array<{ path: string; aiImport: string }> = [
  { path: 'server/anomaly-detection.ts', aiImport: "from './ai.js'" },
  { path: 'server/chat-memory.ts', aiImport: "from './ai.js'" },
  { path: 'server/content-posts-ai.ts', aiImport: "from './ai.js'" },
  { path: 'server/keyword-strategy-ai-synthesis.ts', aiImport: "from './ai.js'" },
  { path: 'server/monthly-digest.ts', aiImport: "from './ai.js'" },
  { path: 'server/content-decay.ts', aiImport: "from './ai.js'" },
  { path: 'server/internal-links.ts', aiImport: "from './ai.js'" },
  { path: 'server/page-analysis-job.ts', aiImport: "from './ai.js'" },
  { path: 'server/seo-audit-ai-recs.ts', aiImport: "from './ai.js'" },
  { path: 'server/webflow-seo-bulk-analyze-job.ts', aiImport: "from './ai.js'" },
  { path: 'server/llms-txt-generator.ts', aiImport: "from './ai.js'" },
  { path: 'server/routes/rewrite-chat.ts', aiImport: "from '../ai.js'" },
  { path: 'server/routes/google.ts', aiImport: "from '../ai.js'" },
  { path: 'server/routes/public-analytics.ts', aiImport: "from '../ai.js'" },
  { path: 'server/routes/webflow-keywords.ts', aiImport: "from '../ai.js'" },
  { path: 'server/routes/webflow-seo-page-tools.ts', aiImport: "from '../ai.js'" },
];

const migratedJsonGenerationFiles: Array<{ path: string; aiImport: string }> = [
  { path: 'server/brandscript.ts', aiImport: "from './ai.js'" },
  { path: 'server/aeo-page-review.ts', aiImport: "from './ai.js'" },
  { path: 'server/content-brief.ts', aiImport: "from './ai.js'" },
  { path: 'server/copy-intelligence.ts', aiImport: "from './ai.js'" },
  { path: 'server/copy-refresh.ts', aiImport: "from './ai.js'" },
  { path: 'server/diagnostic-orchestrator.ts', aiImport: "from './ai.js'" },
  { path: 'server/discovery-ingestion.ts', aiImport: "from './ai.js'" },
  { path: 'server/copy-voice-feedback.ts', aiImport: "from './ai.js'" },
  { path: 'server/meeting-brief-generator.ts', aiImport: "from './ai.js'" },
  { path: 'server/schema-plan.ts', aiImport: "from './ai.js'" },
  { path: 'server/routes/content-posts.ts', aiImport: "from '../ai.js'" },
  { path: 'server/routes/content-publish.ts', aiImport: "from '../ai.js'" },
];

const migratedParsedJsonTextFiles: Array<{ path: string; aiImport: string }> = [
  { path: 'server/keyword-recommendations.ts', aiImport: "from './ai.js'" },
  { path: 'server/routes/ai.ts', aiImport: "from '../ai.js'" },
  { path: 'server/routes/workspaces.ts', aiImport: "from '../ai.js'" },
];

const migratedAnthropicGenerationFiles: Array<{ path: string; aiImport: string }> = [
  { path: 'server/blueprint-generator.ts', aiImport: "from './ai.js'" },
  { path: 'server/copy-generation.ts', aiImport: "from './ai.js'" },
];

describe('AI dispatch migration', () => {
  it('keeps migrated general generation paths on callAI', () => {
    for (const file of migratedGeneralGenerationFiles) {
      const source = readFileSync(file.path, 'utf-8');
      expect(source, file.path).toContain(file.aiImport);
      expect(source, file.path).toContain('callAI({');
      expect(source, file.path).not.toContain("from './openai-helpers.js'");
      expect(source, file.path).not.toContain("from '../openai-helpers.js'");
      expect(source, file.path).not.toContain('callOpenAI({');
    }
  });

  it('keeps migrated JSON-mode generation paths on callAI responseFormat', () => {
    for (const file of migratedJsonGenerationFiles) {
      const source = readFileSync(file.path, 'utf-8');
      expect(source, file.path).toContain(file.aiImport);
      expect(source, file.path).toContain('callAI({');
      expect(source, file.path).toContain("responseFormat: { type: 'json_object' }");
      // Parsing helpers may still live in openai-helpers; migrated files must not import the provider call.
      expect(source, file.path).not.toMatch(
        /import\s+\{[^}]*\bcallOpenAI\b[^}]*\}\s+from ['"]\.\.?\/openai-helpers\.js['"]/,
      );
      expect(source, file.path).not.toContain('callOpenAI({');
    }
  });

  it('keeps migrated parsed-JSON text generation paths on callAI', () => {
    for (const file of migratedParsedJsonTextFiles) {
      const source = readFileSync(file.path, 'utf-8');
      expect(source, file.path).toContain(file.aiImport);
      expect(source, file.path).toContain('callAI({');
      // Parsing helpers may still live in openai-helpers; migrated files must not import the provider call.
      expect(source, file.path).not.toMatch(
        /import\s+\{[^}]*\bcallOpenAI\b[^}]*\}\s+from ['"]\.\.?\/openai-helpers\.js['"]/,
      );
      expect(source, file.path).not.toContain('callOpenAI({');
    }
  });

  it('keeps migrated Anthropic generation paths on callAI provider dispatch', () => {
    for (const file of migratedAnthropicGenerationFiles) {
      const source = readFileSync(file.path, 'utf-8');
      expect(source, file.path).toContain(file.aiImport);
      expect(source, file.path).toContain('callAI({');
      expect(source, file.path).toContain("provider: 'anthropic'");
      expect(source, file.path).not.toContain("from './anthropic-helpers.js'");
      expect(source, file.path).not.toContain('callAnthropic({');
    }
  });

  it('keeps bulk SEO job creative copy on the unified creative dispatcher', () => {
    const source = readFileSync('server/routes/jobs.ts', 'utf-8'); // readFile-ok — source contract for bulk SEO job dispatcher migration
    expect(source).toContain("from '../content-posts-ai.js'");
    expect(source).toContain('callCreativeAI({');
    expect(source).toContain('systemPrompt: buildSystemPrompt(bulkSeoWorkspaceId');
    expect(source).not.toContain("from '../openai-helpers.js'");
    expect(source).not.toContain("from '../anthropic-helpers.js'");
    expect(source).not.toContain('callOpenAI({');
    expect(source).not.toContain('callAnthropic({');
  });

  it('rejects invalid migration drift if a direct provider call reappears in migrated files', () => {
    const migratedFiles = [
      ...migratedGeneralGenerationFiles,
      ...migratedJsonGenerationFiles,
      ...migratedParsedJsonTextFiles,
      ...migratedAnthropicGenerationFiles,
    ];

    for (const file of migratedFiles) {
      const source = readFileSync(file.path, 'utf-8');
      expect(source, file.path).not.toMatch(/\b(callOpenAI|callAnthropic)\s*\(/);
    }
  });
});
