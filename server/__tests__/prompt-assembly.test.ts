// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../db/index.js';
import { buildSystemPrompt } from '../prompt-assembly.js';

const TEST_WS = `test-prompt-${Date.now()}`;

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, 'Test', 'test-folder', datetime('now'))`
  ).run(TEST_WS);

  // Add custom_prompt_notes column if it doesn't exist yet (Migration 048 adds it in Task 1).
  // This makes the test self-contained so it doesn't depend on migration order.
  try {
    db.prepare(`ALTER TABLE workspaces ADD COLUMN custom_prompt_notes TEXT`).run();
  } catch { // catch-ok — column-exists error is expected in test setup
    // Column already exists — this is fine
  }
});

afterAll(() => {
  db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(TEST_WS);
});

describe('buildSystemPrompt', () => {
  it('returns base instructions when no enrichments exist', () => {
    const result = buildSystemPrompt(TEST_WS, 'Base instructions');
    expect(result).toBe('Base instructions');
  });

  it('appends custom notes when set', () => {
    db.prepare(`UPDATE workspaces SET custom_prompt_notes = ? WHERE id = ?`)
      .run('Always use ROI framing', TEST_WS);
    const result = buildSystemPrompt(TEST_WS, 'Base');
    expect(result).toContain('Always use ROI framing');
    db.prepare(`UPDATE workspaces SET custom_prompt_notes = NULL WHERE id = ?`).run(TEST_WS);
  });

  it('does not include voice layer when voice_profiles table does not exist', () => {
    const result = buildSystemPrompt(TEST_WS, 'Base');
    expect(result).not.toContain('Voice profile');
  });
});
