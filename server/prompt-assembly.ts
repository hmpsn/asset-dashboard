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
 * Returns the trimmed custom_prompt_notes for a workspace, or null if absent.
 * Used by the meeting brief hash to detect admin note changes.
 */
export function getCustomPromptNotes(workspaceId: string): string | null {
  try {
    const row = stmts().getCustomNotes.get(workspaceId) as
      { custom_prompt_notes: string | null } | undefined;
    return row?.custom_prompt_notes?.trim() || null;
  } catch {
    // Graceful degradation: column may not exist in test or legacy DBs
    return null;
  }
}

/**
 * Assembles a system prompt by layering workspace-specific context onto base instructions.
 * Safe to call before Brandscript ships — Layer 2 is a no-op until extended in Task 5b.
 *
 * @param customNotes - Optional pre-fetched custom_prompt_notes. When provided, skips the
 *   internal DB query (avoids a duplicate read if the caller already fetched it for hashing).
 */
export function buildSystemPrompt(
  workspaceId: string,
  baseInstructions: string,
  customNotes?: string | null,
): string {
  const parts: string[] = [baseInstructions];

  // Layer 2: voice DNA (extended in Brandscript Phase 1 — Task 5b)
  // No-op here. voiceDNAToPromptInstructions() and the voice_profiles lookup
  // are added to this file when the voice_profiles table exists (migration 049).

  // Layer 3: per-workspace custom notes
  // Use the pre-fetched value if provided; otherwise query the DB.
  const notes = customNotes !== undefined
    ? customNotes
    : (() => {
        try {
          const row = stmts().getCustomNotes.get(workspaceId) as
            { custom_prompt_notes: string | null } | undefined;
          return row?.custom_prompt_notes?.trim() || null;
        } catch {
          // Graceful degradation: column may not exist in test or legacy DBs
          return null;
        }
      })();

  if (notes) {
    parts.push(`Additional context for this client:\n${notes}`);
  }

  return parts.join('\n\n');
}
