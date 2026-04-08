/**
 * Layered system prompt assembly for all AI features.
 *
 * Layer 1 — base instructions (always present, feature-specific)
 * Layer 2 — voice DNA translation (no-op until Brandscript Task 5b adds it)
 * Layer 3 — per-workspace custom notes (activates when custom_prompt_notes is non-empty)
 *
 * Each layer activates automatically when its data exists — no code changes needed
 * when Brandscript or custom notes ship.
 */

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

// Statement cache (module-level lazy init via createStmtCache — never inside a function)
const stmts = createStmtCache(() => ({
  getCustomNotes: db.prepare(
    `SELECT custom_prompt_notes FROM workspaces WHERE id = ? LIMIT 1`
  ),
}));

/**
 * Assembles a system prompt by layering workspace-specific context onto base instructions.
 * Safe to call before Brandscript ships — Layer 2 is a no-op until extended in Task 5b.
 */
export function buildSystemPrompt(workspaceId: string, baseInstructions: string): string {
  const parts: string[] = [baseInstructions];

  // Layer 2: voice DNA (extended in Brandscript Phase 1 — Task 5b)
  // No-op here. voiceDNAToPromptInstructions() and the voice_profiles lookup
  // are added to this file when the voice_profiles table exists (migration 049).

  // Layer 3: per-workspace custom notes
  try {
    const row = stmts().getCustomNotes.get(workspaceId) as
      { custom_prompt_notes: string | null } | undefined;
    if (row?.custom_prompt_notes?.trim()) {
      parts.push(`Additional context for this client:\n${row.custom_prompt_notes.trim()}`);
    }
  } catch {
    // Graceful degradation: column may not exist in test or legacy DBs
  }

  return parts.join('\n\n');
}
