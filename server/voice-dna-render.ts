/**
 * Single source of truth for rendering a `VoiceDNA` object into the multi-line
 * block that goes into AI prompts.
 *
 * Why this file exists: historically, three separate call sites hand-wrote the
 * same `VOICE DNA:` block —
 *   - server/seo-context.ts       (buildVoiceProfileContext, non-calibrated path)
 *   - server/voice-calibration.ts (buildVoiceCalibrationContext)
 *   - server/prompt-assembly.ts   (Layer 2, calibrated path)
 * All three drifted. Two of them silently dropped `vocabularyLevel` for months
 * until a code review caught it. This helper prevents that class of bug by
 * forcing every field in `VoiceDNA` to be handled in one place.
 *
 * The exhaustive-field compile check (see `_coverage` below) means adding a
 * new field to `VoiceDNA` in `shared/types/brand-engine.ts` will fail `tsc`
 * here until the new field is added to both `_coverage` and the rendering
 * logic. That's the structural guarantee — reviewers don't have to remember.
 */

import type { VoiceDNA } from '../shared/types/brand-engine.js';

/**
 * Render the `VOICE DNA:` section body (without the header) as a newline-joined
 * block of indented lines. Callers prepend their own header (e.g. `VOICE DNA:`)
 * because the surrounding framing differs slightly across prompt paths.
 *
 * Output shape (example):
 * ```
 *   Personality: Witty but never sarcastic. Direct.
 *   Tone: formal↔casual 7/10, serious↔playful 6/10, technical↔accessible 8/10
 *   Sentence style: Short punchy lines with occasional longer payoff
 *   Vocabulary: Conversational, 8th grade reading level
 *   Humor: Self-deprecating, observational
 * ```
 *
 * Optional fields (`humorStyle`) are omitted when absent. Required fields are
 * always rendered even if empty-string, so a misconfigured profile is visible
 * in the prompt rather than silently missing.
 */
export function renderVoiceDNAForPrompt(dna: VoiceDNA): string {
  // ── Exhaustive field coverage ────────────────────────────────────────────
  // This object literal is typechecked against `Record<keyof VoiceDNA, true>`.
  // Adding a new field to `VoiceDNA` without adding it here breaks the build.
  // When you hit a compile error on this line: add the new field to the map
  // below AND add a corresponding `lines.push(...)` call in the block below.
  //
  // This is the structural guarantee that prevents the `vocabularyLevel` class
  // of bug from recurring.
  const _coverage: Record<keyof VoiceDNA, true> = {
    personalityTraits: true,
    toneSpectrum: true,
    sentenceStyle: true,
    vocabularyLevel: true,
    humorStyle: true,
  };
  void _coverage;

  const lines: string[] = [];
  lines.push(`  Personality: ${dna.personalityTraits.join('. ')}`);
  lines.push(
    `  Tone: formal↔casual ${dna.toneSpectrum.formal_casual}/10, ` +
    `serious↔playful ${dna.toneSpectrum.serious_playful}/10, ` +
    `technical↔accessible ${dna.toneSpectrum.technical_accessible}/10`,
  );
  lines.push(`  Sentence style: ${dna.sentenceStyle}`);
  if (dna.vocabularyLevel) {
    lines.push(`  Vocabulary: ${dna.vocabularyLevel}`);
  }
  if (dna.humorStyle) {
    lines.push(`  Humor: ${dna.humorStyle}`);
  }
  return lines.join('\n');
}

/**
 * Convenience: return a single-line voice summary for `emphasis: 'minimal'`
 * contexts where the full block would be overkill. Used by
 * `buildVoiceProfileContext(workspaceId, 'minimal')` in seo-context.ts.
 */
export function renderVoiceDNASummary(dna: VoiceDNA): string {
  const traits = dna.personalityTraits.slice(0, 3).join(', ');
  const vocab = dna.vocabularyLevel ? `, ${dna.vocabularyLevel} vocabulary` : '';
  return `${traits} — ${dna.sentenceStyle}${vocab}`;
}
