import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const migratedGeneralGenerationFiles: Array<{ path: string; aiImport: string }> = [
  { path: 'server/chat-memory.ts', aiImport: "from './ai.js'" },
  { path: 'server/meeting-brief-generator.ts', aiImport: "from './ai.js'" },
  { path: 'server/monthly-digest.ts', aiImport: "from './ai.js'" },
  { path: 'server/content-decay.ts', aiImport: "from './ai.js'" },
  { path: 'server/internal-links.ts', aiImport: "from './ai.js'" },
  { path: 'server/page-analysis-job.ts', aiImport: "from './ai.js'" },
  { path: 'server/seo-audit-ai-recs.ts', aiImport: "from './ai.js'" },
  { path: 'server/webflow-seo-bulk-analyze-job.ts', aiImport: "from './ai.js'" },
  { path: 'server/llms-txt-generator.ts', aiImport: "from './ai.js'" },
  { path: 'server/routes/rewrite-chat.ts', aiImport: "from '../ai.js'" },
  { path: 'server/routes/google.ts', aiImport: "from '../ai.js'" },
  { path: 'server/routes/webflow-keywords.ts', aiImport: "from '../ai.js'" },
  { path: 'server/routes/webflow-seo-page-tools.ts', aiImport: "from '../ai.js'" },
];

const migratedJsonGenerationFiles: Array<{ path: string; aiImport: string }> = [
  { path: 'server/brandscript.ts', aiImport: "from './ai.js'" },
  { path: 'server/copy-intelligence.ts', aiImport: "from './ai.js'" },
  { path: 'server/copy-refresh.ts', aiImport: "from './ai.js'" },
  { path: 'server/discovery-ingestion.ts', aiImport: "from './ai.js'" },
  { path: 'server/copy-voice-feedback.ts', aiImport: "from './ai.js'" },
];

const migratedParsedJsonTextFiles: Array<{ path: string; aiImport: string }> = [
  { path: 'server/routes/workspaces.ts', aiImport: "from '../ai.js'" },
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
});
