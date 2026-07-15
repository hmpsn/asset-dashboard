/**
 * Layered system prompt assembly for all AI features.
 *
 * Layer 1 — base instructions (always present, feature-specific)
 * Layer 2 — calibrated voice DNA + guardrails
 * Layer 3 — per-workspace custom notes (activates when custom_prompt_notes is non-empty)
 * Layer 4 — universal prose quality rules (skippable only for complete style systems)
 *
 * Each layer activates automatically when its data exists — no code changes needed
 * when Brandscript or custom notes ship.
 */

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { VoiceDNA, VoiceGuardrails } from '../shared/types/brand-engine.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';
import { PROSE_QUALITY_RULES } from './writing-quality.js';
import { voiceDNAToPromptInstructions, guardrailsToPromptInstructions } from './voice-dna-layer2.js';

// Re-export the Layer-2 voice renderers (moved to the cycle-safe leaf
// server/voice-dna-layer2.ts) so existing importers of prompt-assembly keep working.
export { voiceDNAToPromptInstructions, guardrailsToPromptInstructions };

export interface SystemPromptAuthority {
  /** Already-rendered calibrated DNA + guardrails. Empty when no calibrated authority exists. */
  systemVoiceBlock: string;
  /** Workspace notes captured alongside the generation context. */
  customNotes: string | null;
}

/**
 * Render a system prompt from authority captured earlier in the same logical
 * generation run. This avoids re-reading mutable voice state between stages.
 */
export function buildSystemPromptFromAuthority(
  baseInstructions: string,
  authority: SystemPromptAuthority,
  opts?: { skipProseRules?: boolean },
): string {
  const parts = [baseInstructions];
  const voiceBlock = authority.systemVoiceBlock.trim();
  if (voiceBlock) parts.push(voiceBlock);
  if (authority.customNotes) {
    parts.push(`Additional context for this client:\n${authority.customNotes}`);
  }
  if (!opts?.skipProseRules) parts.push(PROSE_QUALITY_RULES);
  return parts.join('\n\n');
}


const log = createLogger('prompt-assembly');
// Statement cache (module-level lazy init via createStmtCache — never inside a function)
const stmts = createStmtCache(() => ({
  getCustomNotes: db.prepare(
    `SELECT custom_prompt_notes FROM workspaces WHERE id = ? LIMIT 1`
  ),
}));

const voiceStmts = createStmtCache(() => ({
  getVoiceProfile: db.prepare(
    `SELECT status, voice_dna_json, guardrails_json FROM voice_profiles WHERE workspace_id = ? LIMIT 1`
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
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'prompt-assembly/getCustomPromptNotes: programming error');
    // Graceful degradation: column may not exist in test or legacy DBs
    return null;
  }
}

/**
 * Assembles a system prompt by layering workspace-specific context onto base instructions.
 * Safe in workspaces without voice profiles — Layer 2 is a no-op unless a
 * calibrated profile exists.
 *
 * @param customNotes - Optional pre-fetched custom_prompt_notes. When provided, skips the
 *   internal DB query (avoids a duplicate read if the caller already fetched it for hashing).
 * @param opts.skipProseRules - Skip Layer 4 only when the caller already owns a complete
 *   prose/style rule system.
 */
export function buildSystemPrompt(
  workspaceId: string,
  baseInstructions: string,
  customNotes?: string | null,
  opts?: { skipProseRules?: boolean },
): string {
  const parts: string[] = [baseInstructions];

  // ── Layer 2: voice DNA
  try {
    const profileRow = voiceStmts().getVoiceProfile.get(workspaceId) as {
      status: string;
      voice_dna_json: string | null;
      guardrails_json: string | null;
    } | undefined;

    if (profileRow?.status === 'calibrated') {
      const dna = parseJsonFallback<VoiceDNA | null>(profileRow.voice_dna_json, null);
      const guardrails = parseJsonFallback<VoiceGuardrails | null>(profileRow.guardrails_json, null);
      if (dna) parts.push(voiceDNAToPromptInstructions(dna));
      if (guardrails) parts.push(guardrailsToPromptInstructions(guardrails));
    }
  } catch (err) {
    log.debug({ err }, 'prompt-assembly/buildSystemPrompt: expected error — degrading gracefully');
    // voice_profiles table may not exist in test or legacy DBs — graceful degradation
  }

  // Layer 3: per-workspace custom notes
  // Use the pre-fetched value if provided; otherwise query the DB.
  const notes = customNotes !== undefined
    ? customNotes
    : (() => {
        try {
          const row = stmts().getCustomNotes.get(workspaceId) as
            { custom_prompt_notes: string | null } | undefined;
          return row?.custom_prompt_notes?.trim() || null;
        } catch (err) {
          if (isProgrammingError(err)) log.warn({ err }, 'prompt-assembly: programming error');
          // Graceful degradation: column may not exist in test or legacy DBs
          return null;
        }
      })();

  if (notes) {
    parts.push(`Additional context for this client:\n${notes}`);
  }

  // Layer 4: universal prose quality rules (anti-AI-writing patterns)
  // Skipped when the caller already owns a fuller style contract, such as
  // WRITING_QUALITY_RULES or CREATIVE_WRITING_RULES in generation prompts.
  if (!opts?.skipProseRules) {
    parts.push(PROSE_QUALITY_RULES);
  }

  return parts.join('\n\n');
}
