import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const migratedGeneralGenerationFiles: Array<{ path: string; aiImport: string }> = [
  { path: 'server/chat-memory.ts', aiImport: "from './ai.js'" },
  { path: 'server/meeting-brief-generator.ts', aiImport: "from './ai.js'" },
  { path: 'server/monthly-digest.ts', aiImport: "from './ai.js'" },
  { path: 'server/content-decay.ts', aiImport: "from './ai.js'" },
  { path: 'server/internal-links.ts', aiImport: "from './ai.js'" },
  { path: 'server/seo-audit-ai-recs.ts', aiImport: "from './ai.js'" },
  { path: 'server/routes/rewrite-chat.ts', aiImport: "from '../ai.js'" },
  { path: 'server/routes/webflow-keywords.ts', aiImport: "from '../ai.js'" },
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
});
