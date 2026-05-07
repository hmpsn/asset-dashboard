import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { RICH_BLOCKS_PROMPT } from '../../server/prompt-rich-blocks.js';

describe('RICH_BLOCKS_PROMPT shared prompt helper', () => {
  it('is imported from the shared module by admin chat, Google chat, and public analytics prompts', () => {
    expect(RICH_BLOCKS_PROMPT).toContain('RICH RESPONSE BLOCKS');
    expect(readFileSync('server/admin-chat-context.ts', 'utf-8')).toContain("from './prompt-rich-blocks.js'"); // readFile-ok — prompt contract guard: verifies admin chat imports the shared rich blocks prompt.
    expect(readFileSync('server/routes/google.ts', 'utf-8')).toContain("from '../prompt-rich-blocks.js'"); // readFile-ok — prompt contract guard: verifies Google chat imports the shared rich blocks prompt.
    expect(readFileSync('server/routes/public-analytics.ts', 'utf-8')).toContain("from '../prompt-rich-blocks.js'"); // readFile-ok — prompt contract guard: verifies public analytics imports the shared rich blocks prompt.
  });
});
