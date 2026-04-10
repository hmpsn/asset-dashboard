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
import { parseJsonFallback } from './db/json-validation.js';
import type { VoiceDNA, VoiceGuardrails } from '../shared/types/brand-engine.js';

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
  } catch {
    // Graceful degradation: column may not exist in test or legacy DBs
    return null;
  }
}

/**
 * Layer 2 renderer: converts a VoiceDNA into a semantic-translation block that
 * goes into the calibrated system prompt. This is a *different* format from
 * the raw renderer in server/voice-dna-render.ts — this one translates the
 * numeric tone spectrum into natural-language directives ("playful — humor
 * welcome"), whereas the raw renderer shows the numbers directly.
 *
 * Both renderers MUST cover every field in VoiceDNA. See the `_coverage`
 * exhaustive-field guard below and in voice-dna-render.ts.
 */
export function voiceDNAToPromptInstructions(dna: VoiceDNA): string {
  // ── Exhaustive field coverage ────────────────────────────────────────────
  // Typechecked against `Record<keyof VoiceDNA, true>`. Adding a field to
  // VoiceDNA without handling it below breaks the build here.
  const _coverage: Record<keyof VoiceDNA, true> = {
    personalityTraits: true,
    toneSpectrum: true,
    sentenceStyle: true,
    vocabularyLevel: true,
    humorStyle: true,
  };
  void _coverage;

  const formalCasual = dna.toneSpectrum.formal_casual >= 7
    ? 'conversational and casual'
    : dna.toneSpectrum.formal_casual <= 3
      ? 'formal and professional'
      : 'professional but approachable';

  const playfulness = dna.toneSpectrum.serious_playful >= 7
    ? 'playful — humor welcome'
    : dna.toneSpectrum.serious_playful <= 3
      ? 'serious — no jokes'
      : 'measured — light warmth only';

  const accessibility = dna.toneSpectrum.technical_accessible >= 7
    ? 'plain language — avoid jargon'
    : dna.toneSpectrum.technical_accessible <= 3
      ? 'technical — assume domain expertise'
      : 'balanced — define terms where helpful';

  return [
    `Voice profile for this client:`,
    `- Tone: ${formalCasual}`,
    `- Playfulness: ${playfulness}`,
    `- Complexity: ${accessibility}`,
    `- Sentence style: ${dna.sentenceStyle}`,
    `- Vocabulary: ${dna.vocabularyLevel}`,
    dna.humorStyle ? `- Humor: ${dna.humorStyle}` : null,
    dna.personalityTraits.length > 0
      ? `- Personality: ${dna.personalityTraits.join(', ')}`
      : null,
  ].filter(Boolean).join('\n');
}

export function guardrailsToPromptInstructions(guardrails: VoiceGuardrails): string {
  const parts: string[] = ['Voice guardrails:'];
  if (guardrails.forbiddenWords.length > 0) {
    parts.push(`- Never use: ${guardrails.forbiddenWords.join(', ')}`);
  }
  if (guardrails.requiredTerminology.length > 0) {
    const terms = guardrails.requiredTerminology
      .map(t => `"${t.use}" (not "${t.insteadOf}")`).join(', ');
    parts.push(`- Preferred terms: ${terms}`);
  }
  if (guardrails.toneBoundaries.length > 0) {
    parts.push(`- Tone boundaries: ${guardrails.toneBoundaries.join('; ')}`);
  }
  if (guardrails.antiPatterns.length > 0) {
    parts.push(`- Avoid: ${guardrails.antiPatterns.join('; ')}`);
  }
  return parts.join('\n');
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
  } catch {
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
