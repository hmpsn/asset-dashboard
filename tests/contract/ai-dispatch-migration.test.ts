import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const migratedGeneralGenerationFiles = [
  'server/chat-memory.ts',
  'server/meeting-brief-generator.ts',
  'server/monthly-digest.ts',
];

describe('AI dispatch migration', () => {
  it('keeps migrated general generation paths on callAI', () => {
    for (const file of migratedGeneralGenerationFiles) {
      const source = readFileSync(file, 'utf-8');
      expect(source, file).toContain("from './ai.js'");
      expect(source, file).toContain('callAI({');
      expect(source, file).not.toContain("from './openai-helpers.js'");
      expect(source, file).not.toContain('callOpenAI({');
    }
  });
});
