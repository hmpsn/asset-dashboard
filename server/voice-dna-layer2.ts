/**
 * Layer-2 voice DNA renderers (leaf module).
 *
 * Pure functions that translate a calibrated VoiceDNA / VoiceGuardrails into
 * natural-language prompt directives. Extracted from prompt-assembly.ts so that
 * both prompt-assembly (server-side generation) AND the brand intelligence slice
 * (MCP/agent path) can render Layer-2 voice from a single source — without the
 * brand slice having to import the cycle-heavy prompt-assembly / voice-calibration
 * modules.
 *
 * This is a LEAF: it imports ONLY types. Do not add runtime imports here.
 */

import type { VoiceDNA, VoiceGuardrails } from '../shared/types/brand-engine.js';

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
