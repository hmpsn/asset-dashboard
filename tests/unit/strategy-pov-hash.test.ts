import { describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { buildEffectiveBrandVoiceBlock } from '../../server/intelligence/seo-context-source.js';
import { buildSystemPrompt } from '../../server/prompt-assembly.js';
import { buildStrategyPovHash, buildStrategyPovPrompt } from '../../server/strategy-pov-generator.js';
import { createVoiceProfile, updateVoiceProfile } from '../../server/voice-calibration.js';
import type { VoiceDNA, VoiceGuardrails } from '../../shared/types/brand-engine.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

/**
 * AUD-D6: the cache fingerprint is over the exact effective prompts sent to AI.
 * The regenerate nonce is a control-plane cache bypass and is deliberately absent
 * from this pure hash contract.
 */
describe('buildStrategyPovHash', () => {
  const systemPrompt = 'SYSTEM\nVOICE DNA: crisp and direct\nCUSTOM: prefer evidence';
  const userPrompt = 'SITE CONTEXT:\n- Site health score: 81\nBRAND VOICE: plainspoken';

  it('is stable for identical effective prompt inputs', () => {
    expect(buildStrategyPovHash(systemPrompt, userPrompt, 'admin')).toBe(
      buildStrategyPovHash(systemPrompt, userPrompt, 'admin'),
    );
  });

  it('busts for any rendered evidence or effective-user-prompt change', () => {
    expect(buildStrategyPovHash(systemPrompt, `${userPrompt}\n- Overall win rate: 72%`, 'admin')).not.toBe(
      buildStrategyPovHash(systemPrompt, userPrompt, 'admin'),
    );
  });

  it('busts for effective system-prompt changes such as calibrated voice or custom notes', () => {
    expect(buildStrategyPovHash(`${systemPrompt}\nNever say leverage.`, userPrompt, 'admin')).not.toBe(
      buildStrategyPovHash(systemPrompt, userPrompt, 'admin'),
    );
  });

  it('keeps admin and client variants isolated', () => {
    expect(buildStrategyPovHash(systemPrompt, userPrompt, 'client')).not.toBe(
      buildStrategyPovHash(systemPrompt, userPrompt, 'admin'),
    );
  });

  it('omits the user-prompt voice section for a calibrated profile with DNA but no samples', () => {
    const seeded = seedWorkspace();
    const dna: VoiceDNA = {
      personalityTraits: ['direct', 'specific'],
      toneSpectrum: { formal_casual: 6, serious_playful: 3, technical_accessible: 8 },
      sentenceStyle: 'Calibrated DNA sentinel: short declarative sentences.',
      vocabularyLevel: 'Plain operator language',
    };
    const guardrails: VoiceGuardrails = {
      forbiddenWords: ['synergy-sentinel'],
      requiredTerminology: [],
      toneBoundaries: ['No hype'],
      antiPatterns: [],
    };

    try {
      createVoiceProfile(seeded.workspaceId);
      updateVoiceProfile(seeded.workspaceId, { status: 'calibrating', voiceDNA: dna, guardrails });
      db.prepare(`UPDATE voice_profiles SET status = 'calibrated' WHERE workspace_id = ?`) // status-ok: compatibility fixture for calibrated prompt hashing
        .run(seeded.workspaceId);

      const effectiveVoice = buildEffectiveBrandVoiceBlock(seeded.workspaceId);
      const system = buildSystemPrompt(seeded.workspaceId, 'Draft a strategy POV.');
      const user = buildStrategyPovPrompt({
        workspaceId: seeded.workspaceId,
        version: 1,
        assembledAt: new Date().toISOString(),
        seoContext: {
          strategy: undefined,
          brandVoice: '',
          effectiveBrandVoiceBlock: effectiveVoice,
          businessContext: '',
          personas: [],
          knowledgeBase: '',
          effectiveLocalSeoBlock: '',
          latestSnapshotAt: null,
        },
      } as WorkspaceIntelligence, [], 'admin');

      expect(effectiveVoice).toBe('');
      expect(system).toContain(dna.sentenceStyle);
      expect(user).not.toContain('EFFECTIVE BRAND VOICE');
      expect(user).not.toContain('no brand voice');
    } finally {
      db.prepare('DELETE FROM voice_samples WHERE voice_profile_id IN (SELECT id FROM voice_profiles WHERE workspace_id = ?)').run(seeded.workspaceId);
      db.prepare('DELETE FROM voice_profiles WHERE workspace_id = ?').run(seeded.workspaceId);
      seeded.cleanup();
    }
  });
});
