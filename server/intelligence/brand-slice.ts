import type { BrandSlice } from '../../shared/types/intelligence.js';
import { buildEffectiveBrandVoiceBlock, getRawBrandVoice, safeBrandEngineRead } from './seo-context-source.js';
import { getVoiceProfile } from '../voice-profile-read-model.js';
import { listDeliverables } from '../brand-deliverable-read-model.js';
import { voiceDNAToPromptInstructions, guardrailsToPromptInstructions } from '../voice-dna-layer2.js';

const IDENTITY_FIELDS = [
  ['mission', 'Mission'], ['vision', 'Vision'], ['values', 'Values'],
  ['tagline', 'Tagline'], ['elevator_pitch', 'Elevator pitch'], ['positioning_matrix', 'Positioning'],
] as const;
// deliverableType → BrandSlice.identity key. Intentionally surfaces only the 6 core
// identity deliverables as structured fields. Voice/messaging deliverable types
// (voice_guidelines, messaging_pillars, differentiators, brand_story, personas, …) are
// deliberately omitted: voice is carried by voicePromptBlock, the rest are deferred to a
// later phase. Unmapped types are skipped (key === undefined) — expected, not a bug.
const TYPE_TO_KEY: Record<string, keyof BrandSlice['identity']> = {
  mission: 'mission', vision: 'vision', values: 'values',
  tagline: 'tagline', elevator_pitch: 'elevatorPitch', positioning_matrix: 'positioning',
};

export async function assembleBrand(workspaceId: string): Promise<BrandSlice> {
  // INVARIANT: voicePromptBlock must stay byte-identical to SeoContextSlice.effectiveBrandVoiceBlock
  // (seo-context-slice.ts) — both call the SAME buildEffectiveBrandVoiceBlock(). The safeBrandEngineRead
  // wrapper only diverges on a thrown error (→ ''). Enforced by
  // tests/contract/voice-block-slice-parity.test.ts — don't change one source without the other.
  const voicePromptBlock = safeBrandEngineRead('brand.voiceBlock', workspaceId, () => buildEffectiveBrandVoiceBlock(workspaceId), '');
  const profile = safeBrandEngineRead('brand.voiceProfile', workspaceId, () => getVoiceProfile(workspaceId), null);
  const legacyVoice = safeBrandEngineRead('brand.rawVoice', workspaceId, () => getRawBrandVoice(workspaceId), '');
  // Coarse hint only (calibrated vs raw-legacy-text vs none). A configured-but-not-calibrated
  // profile can still yield a non-empty voicePromptBlock while this reports 'none' — treat
  // voicePromptBlock / availability, not voice.status, as authoritative for "is there voice".
  const status: BrandSlice['voice']['status'] =
    profile?.status === 'calibrated' ? 'calibrated' : (legacyVoice.trim() ? 'legacy' : 'none');

  // Layer-2 voice DNA + guardrails — populated ONLY for calibrated profiles.
  // For non-calibrated profiles the DNA is already inside voicePromptBlock
  // (via buildEffectiveBrandVoiceBlock), so emitting it here would double-inject.
  let voiceDnaBlock = '';
  if (profile?.status === 'calibrated') {
    const parts: string[] = [];
    if (profile.voiceDNA) parts.push(voiceDNAToPromptInstructions(profile.voiceDNA));
    if (profile.guardrails) parts.push(guardrailsToPromptInstructions(profile.guardrails));
    if (parts.length) {
      voiceDnaBlock = `\n\nBRAND VOICE RULES (you MUST follow these — do not deviate):\n${parts.join('\n\n')}`;
    }
  }

  const approved = safeBrandEngineRead('brand.identity', workspaceId, () => listDeliverables(workspaceId), [])
    .filter(d => d.status === 'approved');
  const identity: BrandSlice['identity'] = {};
  for (const d of approved) {
    const key = TYPE_TO_KEY[d.deliverableType];
    if (key && d.content.trim()) identity[key] = d.content.trim();
  }

  const idLines: string[] = [];
  for (const [type, label] of IDENTITY_FIELDS) {
    const key = TYPE_TO_KEY[type];
    const val = identity[key];
    if (val) idLines.push(`${label}: ${val}`);
  }
  const identityPromptBlock = idLines.length
    ? `\n\nBRAND IDENTITY (ground the brand's positioning in these):\n${idLines.join('\n')}`
    : '';

  const availability: BrandSlice['availability'] =
    (idLines.length > 0 || voicePromptBlock.trim()) ? 'ready' : 'no_data';

  return { availability, identity, voice: { status }, voicePromptBlock, voiceDnaBlock, identityPromptBlock };
}
