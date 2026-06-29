import type { BrandSlice } from '../../shared/types/intelligence.js';
import { buildEffectiveBrandVoiceBlock, getRawBrandVoice } from './seo-context-source.js';
import { getVoiceProfile } from '../voice-profile-read-model.js';
import { listDeliverables } from '../brand-deliverable-read-model.js';
import { createLogger } from '../logger.js';

const log = createLogger('workspace-intelligence/brand');
const MISSING_SCHEMA_ERROR_RE = /no such (table|column)/i;

function safeRead<T>(context: string, workspaceId: string, fn: () => T, fallback: T): T {
  try { return fn(); } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!MISSING_SCHEMA_ERROR_RE.test(message)) throw err;
    log.warn({ context, workspaceId, error: message }, 'brand read degraded to fallback');
    return fallback;
  }
}

const IDENTITY_FIELDS = [
  ['mission', 'Mission'], ['vision', 'Vision'], ['values', 'Values'],
  ['tagline', 'Tagline'], ['elevator_pitch', 'Elevator pitch'], ['positioning_matrix', 'Positioning'],
] as const;
// deliverableType → BrandSlice.identity key
const TYPE_TO_KEY: Record<string, keyof BrandSlice['identity']> = {
  mission: 'mission', vision: 'vision', values: 'values',
  tagline: 'tagline', elevator_pitch: 'elevatorPitch', positioning_matrix: 'positioning',
};

export async function assembleBrand(workspaceId: string): Promise<BrandSlice> {
  const voicePromptBlock = safeRead('brand.voiceBlock', workspaceId, () => buildEffectiveBrandVoiceBlock(workspaceId), '');
  const profile = safeRead('brand.voiceProfile', workspaceId, () => getVoiceProfile(workspaceId), null);
  const legacyVoice = safeRead('brand.rawVoice', workspaceId, () => getRawBrandVoice(workspaceId), '');
  const status: BrandSlice['voice']['status'] =
    profile?.status === 'calibrated' ? 'calibrated' : (legacyVoice.trim() ? 'legacy' : 'none');

  const approved = safeRead('brand.identity', workspaceId, () => listDeliverables(workspaceId), [])
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

  return { availability, identity, voice: { status }, voicePromptBlock, identityPromptBlock };
}
