import { afterEach, describe, expect, it } from 'vitest';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import { buildSystemPrompt } from '../../server/prompt-assembly.js';
import { PROSE_QUALITY_RULES } from '../../server/writing-quality.js';
import { buildEffectiveBrandVoiceBlock } from '../../server/intelligence/seo-context-source.js';
import { addVoiceSample, createVoiceProfile, updateVoiceProfile } from '../../server/voice-calibration.js';
import type { VoiceDNA, VoiceGuardrails } from '../../shared/types/brand-engine.js';

const JSON_BASE_INSTRUCTIONS = 'Return ONLY valid JSON with keys "summary" and "nextSteps". No markdown, no prose outside JSON.';
const LEGACY_BRAND_VOICE = 'Legacy voice sentinel: direct, local, and practical.';
const SAMPLE_TEXT = 'Sample sentinel: name the tradeoff first, then give the practical next move.';

const fixtureWorkspaces: SeededFullWorkspace[] = [];

function makeDNA(overrides: Partial<VoiceDNA> = {}): VoiceDNA {
  return {
    personalityTraits: ['plainspoken', 'specific'],
    toneSpectrum: {
      formal_casual: 8,
      serious_playful: 4,
      technical_accessible: 7,
    },
    sentenceStyle: 'Start with the point, then explain the tradeoff.',
    vocabularyLevel: 'Clear operator language',
    humorStyle: 'Dry restraint',
    ...overrides,
  };
}

function makeGuardrails(overrides: Partial<VoiceGuardrails> = {}): VoiceGuardrails {
  return {
    forbiddenWords: ['synergy'],
    requiredTerminology: [{ use: 'search demand', insteadOf: 'SEO juice' }],
    toneBoundaries: ['No hype', 'No fake urgency'],
    antiPatterns: ['Do not bury the recommendation after throat-clearing'],
    ...overrides,
  };
}

function cleanupVoiceProfile(workspaceId: string): void {
  db.prepare(`
    DELETE FROM voice_samples
    WHERE voice_profile_id IN (
      SELECT id FROM voice_profiles WHERE workspace_id = ?
    )
  `).run(workspaceId);
  db.prepare('DELETE FROM voice_profiles WHERE workspace_id = ?').run(workspaceId);
}

function seedVoiceFixture(variant: 'calibrated' | 'draft-samples-only' | 'draft-configured' | 'legacy-only' | 'none'): SeededFullWorkspace {
  const seeded = seedWorkspace({ tier: 'growth', clientPassword: '' });
  fixtureWorkspaces.push(seeded);

  if (variant !== 'none') {
    db.prepare('UPDATE workspaces SET brand_voice = ? WHERE id = ?').run(LEGACY_BRAND_VOICE, seeded.workspaceId);
  }

  if (variant === 'calibrated') {
    createVoiceProfile(seeded.workspaceId);
    addVoiceSample(seeded.workspaceId, SAMPLE_TEXT, 'body', 'manual');
    updateVoiceProfile(seeded.workspaceId, {
      status: 'calibrating',
      voiceDNA: makeDNA(),
      guardrails: makeGuardrails(),
    });
    db.prepare(`UPDATE voice_profiles SET status = 'calibrated' WHERE workspace_id = ?`) // status-ok: compatibility fixture for calibrated Layer-2 prompt behavior
      .run(seeded.workspaceId);
  }

  if (variant === 'draft-samples-only') {
    createVoiceProfile(seeded.workspaceId);
    addVoiceSample(seeded.workspaceId, SAMPLE_TEXT, 'body', 'manual');
  }

  if (variant === 'draft-configured') {
    createVoiceProfile(seeded.workspaceId);
    addVoiceSample(seeded.workspaceId, SAMPLE_TEXT, 'body', 'manual');
    updateVoiceProfile(seeded.workspaceId, {
      voiceDNA: makeDNA(),
      guardrails: makeGuardrails(),
    });
  }

  return seeded;
}

function renderFixture(variant: Parameters<typeof seedVoiceFixture>[0]): { systemPrompt: string; brandVoiceBlock: string } {
  const seeded = seedVoiceFixture(variant);
  return {
    systemPrompt: buildSystemPrompt(seeded.workspaceId, JSON_BASE_INSTRUCTIONS),
    brandVoiceBlock: buildEffectiveBrandVoiceBlock(seeded.workspaceId),
  };
}

afterEach(() => {
  for (const seeded of fixtureWorkspaces.splice(0)) {
    cleanupVoiceProfile(seeded.workspaceId);
    seeded.cleanup();
  }
});

describe('voice quality contract harness', () => {
  it('calibrated profiles inject DNA and guardrails through the system prompt without duplicating them in the brand block', () => {
    const { systemPrompt, brandVoiceBlock } = renderFixture('calibrated');

    expect(systemPrompt).toContain('Voice profile for this client:');
    expect(systemPrompt).toContain('Voice guardrails:');
    expect(systemPrompt).toContain('Never use: synergy');
    expect(systemPrompt).toContain(PROSE_QUALITY_RULES.trim());

    expect(brandVoiceBlock).toContain('BRAND VOICE PROFILE');
    expect(brandVoiceBlock).toContain(SAMPLE_TEXT);
    expect(brandVoiceBlock).not.toContain('VOICE DNA:');
    expect(brandVoiceBlock).not.toContain('GUARDRAILS:');
    expect(brandVoiceBlock).not.toContain(LEGACY_BRAND_VOICE);
  });

  it('draft profiles with samples only do not override the legacy brand voice block', () => {
    const { systemPrompt, brandVoiceBlock } = renderFixture('draft-samples-only');

    expect(systemPrompt).not.toContain('Voice profile for this client:');
    expect(systemPrompt).not.toContain('Voice guardrails:');
    expect(brandVoiceBlock).toContain('BRAND VOICE & STYLE');
    expect(brandVoiceBlock).toContain(LEGACY_BRAND_VOICE);
    expect(brandVoiceBlock).not.toContain(SAMPLE_TEXT);
  });

  it('draft profiles with DNA or guardrails become the effective brand voice block until calibration moves them to Layer 2', () => {
    const { systemPrompt, brandVoiceBlock } = renderFixture('draft-configured');

    expect(systemPrompt).not.toContain('Voice profile for this client:');
    expect(systemPrompt).not.toContain('Voice guardrails:');
    expect(brandVoiceBlock).toContain('BRAND VOICE PROFILE');
    expect(brandVoiceBlock).toContain('VOICE DNA:');
    expect(brandVoiceBlock).toContain('GUARDRAILS:');
    expect(brandVoiceBlock).toContain(SAMPLE_TEXT);
    expect(brandVoiceBlock).toContain('Never use: synergy');
    expect(brandVoiceBlock).not.toContain(LEGACY_BRAND_VOICE);
  });

  it('legacy brand voice only still reaches the effective brand voice block', () => {
    const { systemPrompt, brandVoiceBlock } = renderFixture('legacy-only');

    expect(systemPrompt).not.toContain('Voice profile for this client:');
    expect(systemPrompt).not.toContain('Voice guardrails:');
    expect(brandVoiceBlock).toContain('BRAND VOICE & STYLE');
    expect(brandVoiceBlock).toContain(LEGACY_BRAND_VOICE);
  });

  it('workspaces with no voice data still get base instructions and universal prose quality rules', () => {
    const { systemPrompt, brandVoiceBlock } = renderFixture('none');

    expect(systemPrompt).toContain(JSON_BASE_INSTRUCTIONS);
    expect(systemPrompt).toContain(PROSE_QUALITY_RULES.trim());
    expect(systemPrompt).not.toContain('Voice profile for this client:');
    expect(systemPrompt).not.toContain('Voice guardrails:');
    expect(brandVoiceBlock).toBe('');
  });

  it.each([
    'calibrated',
    'draft-samples-only',
    'draft-configured',
    'legacy-only',
    'none',
  ] as const)('preserves strict output-format instructions first for %s fixtures', variant => {
    const { systemPrompt } = renderFixture(variant);

    expect(systemPrompt.startsWith(JSON_BASE_INSTRUCTIONS)).toBe(true);
    expect(systemPrompt.indexOf(JSON_BASE_INSTRUCTIONS)).toBe(0);
    expect(systemPrompt).toContain(PROSE_QUALITY_RULES.trim());
  });
});
