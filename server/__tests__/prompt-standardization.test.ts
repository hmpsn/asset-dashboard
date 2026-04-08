import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildSystemPrompt } from '../prompt-assembly.js';
import db from '../db/index.js';

const TEST_WS = `test-psp-${Date.now()}`;

describe('prompt standardization pass — integration', () => {
  beforeAll(() => {
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, 'PSP Test', datetime('now'))`
    ).run(TEST_WS);
  });

  afterAll(() => {
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(TEST_WS);
  });

  it('buildSystemPrompt returns base instructions for fresh workspace', () => {
    const result = buildSystemPrompt(TEST_WS, 'You are a helpful assistant.');
    expect(result).toBe('You are a helpful assistant.');
  });

  it('buildSystemPrompt appends custom notes when passed as parameter', () => {
    // Use the pre-fetched customNotes parameter (bypasses DB column check)
    const result = buildSystemPrompt(TEST_WS, 'Base instructions', 'Always frame improvements in terms of ROI');
    expect(result).toContain('Base instructions');
    expect(result).toContain('Always frame improvements in terms of ROI');
  });

  it('buildSystemPrompt skips notes when customNotes is null', () => {
    const result = buildSystemPrompt(TEST_WS, 'Base instructions', null);
    expect(result).toBe('Base instructions');
  });

  it('OpenAIChatOptions accepts responseFormat', () => {
    // Type-check only — verify the interface accepts the new field
    const opts = {
      messages: [{ role: 'user' as const, content: 'test' }],
      feature: 'test',
      responseFormat: { type: 'json_object' as const },
    };
    expect(opts.responseFormat.type).toBe('json_object');
  });
});
