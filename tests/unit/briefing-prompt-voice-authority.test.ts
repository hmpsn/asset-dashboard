import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '../../server/db/index.js';
import {
  addVoiceSample,
  createVoiceProfile,
  updateVoiceProfile,
} from '../../server/voice-calibration.js';
import type { VoiceDNA, VoiceGuardrails } from '../../shared/types/brand-engine.js';

const callAI = vi.fn();
vi.mock('../../server/ai.js', () => ({
  callAI: (...args: unknown[]) => callAI(...args),
}));

import { punchHeroHeadline } from '../../server/briefing-prompt.js';

const LEGACY_VOICE = 'Legacy briefing voice sentinel: practical, direct, and warm.';
const SAMPLE_TEXT = 'Sample briefing voice sentinel: lead with the decision and name the tradeoff.';
const DNA_SENTENCE_STYLE = 'DNA briefing sentinel: short, decisive sentences.';
const FORBIDDEN_WORD = 'synergy-sentinel';

const DNA: VoiceDNA = {
  personalityTraits: ['direct', 'specific'],
  toneSpectrum: {
    formal_casual: 7,
    serious_playful: 4,
    technical_accessible: 8,
  },
  sentenceStyle: DNA_SENTENCE_STYLE,
  vocabularyLevel: 'Plain operator language',
};

const GUARDRAILS: VoiceGuardrails = {
  forbiddenWords: [FORBIDDEN_WORD],
  requiredTerminology: [],
  toneBoundaries: ['No hype'],
  antiPatterns: [],
};

interface SeededWorkspace {
  workspaceId: string;
  cleanup: () => void;
}

function seedWorkspace(): SeededWorkspace {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `test-briefing-voice-${suffix}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO workspaces (id, name, folder, webflow_site_id, webflow_token, brand_voice, tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    `Briefing Voice ${suffix}`,
    `briefing-voice-${suffix}`,
    `briefing-site-${suffix}`,
    `briefing-token-${suffix}`,
    LEGACY_VOICE,
    'growth',
    now,
  );

  return {
    workspaceId,
    cleanup: () => {
      db.prepare(`
        DELETE FROM voice_samples
        WHERE voice_profile_id IN (SELECT id FROM voice_profiles WHERE workspace_id = ?)
      `).run(workspaceId);
      db.prepare('DELETE FROM voice_profiles WHERE workspace_id = ?').run(workspaceId);
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
    },
  };
}

async function captureSystemPrompt(workspaceId: string): Promise<string> {
  callAI.mockResolvedValue({
    text: 'Fleet maintenance page reached the top five.',
    tokens: { prompt: 10, completion: 8, total: 18 },
  });
  await punchHeroHeadline(
    'Fleet maintenance page entered the top five.',
    'ranking_mover: /fleet #11 to #4',
    workspaceId,
  );
  return callAI.mock.calls.at(-1)?.[0]?.system as string;
}

describe('briefing prompt voice authority', () => {
  let seeded: SeededWorkspace | null = null;

  beforeEach(() => {
    callAI.mockReset();
    seeded = seedWorkspace();
  });

  afterEach(() => {
    seeded?.cleanup();
    seeded = null;
  });

  it('includes the real legacy workspace voice when no authoritative profile exists', async () => {
    const system = await captureSystemPrompt(seeded!.workspaceId);

    expect(system).toContain(LEGACY_VOICE);
    expect(system.match(new RegExp(LEGACY_VOICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
  });

  it('uses configured draft DNA, guardrails, and samples instead of legacy voice', async () => {
    createVoiceProfile(seeded!.workspaceId);
    addVoiceSample(seeded!.workspaceId, SAMPLE_TEXT, 'body', 'manual');
    updateVoiceProfile(seeded!.workspaceId, { voiceDNA: DNA, guardrails: GUARDRAILS });

    const system = await captureSystemPrompt(seeded!.workspaceId);

    expect(system).toContain(DNA_SENTENCE_STYLE);
    expect(system).toContain(SAMPLE_TEXT);
    expect(system).toContain(FORBIDDEN_WORD);
    expect(system).not.toContain(LEGACY_VOICE);
  });

  it('combines calibrated DNA and guardrails with calibrated samples exactly once', async () => {
    createVoiceProfile(seeded!.workspaceId);
    addVoiceSample(seeded!.workspaceId, SAMPLE_TEXT, 'body', 'manual');
    updateVoiceProfile(seeded!.workspaceId, {
      status: 'calibrating',
      voiceDNA: DNA,
      guardrails: GUARDRAILS,
    });
    db.prepare(`UPDATE voice_profiles SET status = 'calibrated' WHERE workspace_id = ?`) // status-ok: compatibility fixture for Layer-2 legacy prompt behavior
      .run(seeded!.workspaceId);

    const system = await captureSystemPrompt(seeded!.workspaceId);

    expect(system).toContain(DNA_SENTENCE_STYLE);
    expect(system).toContain(FORBIDDEN_WORD);
    expect(system).toContain(SAMPLE_TEXT);
    expect(system.match(new RegExp(SAMPLE_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(system).not.toContain(LEGACY_VOICE);
  });
});
