/**
 * Regression test for the `hasVoiceProfile` silent-drop bug in buildSeoContext.
 *
 * Bug (pre-fix): `buildSeoContext` at server/seo-context.ts:120 / :174 used
 * `getVoiceProfile(workspaceId) !== null` to decide whether to replace the
 * legacy `brandVoiceBlock` (containing workspace.brandVoice + brand-docs
 * content) with `voiceProfileBlock`. When a profile existed but produced an
 * empty block — e.g. a fresh draft auto-created on GET /api/voice/:id, or a
 * calibrated profile with zero samples — the legacy brand voice was silently
 * replaced with '' and permanently dropped from the prompt.
 *
 * Fix: the check now evaluates the profile as authoritative only when
 *   (a) status === 'calibrated' (Layer 2 in buildSystemPrompt handles it), OR
 *   (b) the rendered voiceProfileBlock is non-empty.
 *
 * This file covers the three scenarios that matter:
 *   1. Draft profile exists but produced no block  → fall back to legacy ✓
 *   2. Calibrated profile with ≥1 sample           → use profile, drop legacy ✓
 *   3. Calibrated profile with zero samples        → use profile, drop legacy ✓
 *      (Layer 2 still injects DNA + guardrails into the system prompt — we
 *      must NOT double-inject legacy into the user prompt.)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';
import { buildSeoContext, clearSeoContextCache } from '../../server/seo-context.js';
import {
  getOrCreateVoiceProfile,
  addVoiceSample,
  updateVoiceProfile,
  VoiceProfileStateTransitionError,
} from '../../server/voice-calibration.js';
import type { VoiceDNA, VoiceGuardrails } from '../../shared/types/brand-engine.js';

const LEGACY_VOICE_TEXT = 'Professional but warm. Active voice. No filler.';
const SAMPLE_TEXT = 'Stop guessing at your SEO strategy — we map it out for you.';

const SENTINEL_DNA: VoiceDNA = {
  personalityTraits: ['Confident', 'Direct'],
  toneSpectrum: { formal_casual: 6, serious_playful: 5, technical_accessible: 7 },
  sentenceStyle: 'Short punchy lines.',
  vocabularyLevel: 'Conversational, 8th grade.',
};

const SENTINEL_GUARDRAILS: VoiceGuardrails = {
  forbiddenWords: ['synergy'],
  requiredTerminology: [],
  toneBoundaries: ['Never condescending'],
  antiPatterns: [],
};

interface SeededWs {
  workspaceId: string;
  cleanup: () => void;
}

/** Seed a workspace with a legacy brandVoice freeform string set. */
function seedWorkspaceWithLegacyVoice(): SeededWs {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `test-ws-voice-${suffix}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO workspaces (id, name, folder, webflow_site_id, webflow_token, brand_voice, tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    `Voice Test Workspace ${suffix}`,
    `voice-test-workspace-${suffix}`,
    `voice-test-site-${suffix}`,
    `voice-test-token-${suffix}`,
    LEGACY_VOICE_TEXT,
    'free',
    now,
  );

  const cleanup = () => {
    db.prepare('DELETE FROM voice_samples WHERE voice_profile_id IN (SELECT id FROM voice_profiles WHERE workspace_id = ?)').run(workspaceId);
    db.prepare('DELETE FROM voice_profiles WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
    clearSeoContextCache(workspaceId);
  };

  return { workspaceId, cleanup };
}

describe('buildSeoContext — voice profile authority vs legacy brand voice', () => {
  let seeded: SeededWs | null = null;

  afterEach(() => {
    seeded?.cleanup();
    seeded = null;
  });

  it('preserves legacy brand voice when only a draft profile exists (auto-created on GET)', () => {
    // Simulates: admin has workspace.brandVoice set, visits Voice tab, which
    // triggers GET /api/voice/:id → getOrCreateVoiceProfile inserts a draft row.
    // Pre-fix, the mere existence of that draft row caused the legacy brand
    // voice to be silently dropped from every subsequent prompt.
    seeded = seedWorkspaceWithLegacyVoice();
    const profile = getOrCreateVoiceProfile(seeded.workspaceId);
    expect(profile.status).toBe('draft');
    expect(profile.samples).toHaveLength(0);
    clearSeoContextCache(seeded.workspaceId);

    const ctx = buildSeoContext(seeded.workspaceId, undefined, 'strategy', { _skipShadow: true });

    expect(ctx.fullContext).toContain(LEGACY_VOICE_TEXT);
    expect(ctx.brandVoiceBlock).toContain(LEGACY_VOICE_TEXT);
  });

  it('uses voice profile and drops legacy when profile is calibrated with ≥1 sample', () => {
    seeded = seedWorkspaceWithLegacyVoice();
    getOrCreateVoiceProfile(seeded.workspaceId);
    addVoiceSample(seeded.workspaceId, SAMPLE_TEXT, 'body', 'manual');
    // State machine enforces draft → calibrating → calibrated — cannot skip calibrating.
    updateVoiceProfile(seeded.workspaceId, { status: 'calibrating' });
    updateVoiceProfile(seeded.workspaceId, {
      status: 'calibrated',
      voiceDNA: SENTINEL_DNA,
      guardrails: SENTINEL_GUARDRAILS,
    });
    clearSeoContextCache(seeded.workspaceId);

    const ctx = buildSeoContext(seeded.workspaceId, undefined, 'strategy', { _skipShadow: true });

    // Legacy must be gone — the voice profile is now the single source of truth
    expect(ctx.fullContext).not.toContain(LEGACY_VOICE_TEXT);
    // The calibrated voice profile block contains the sample (DNA + guardrails
    // are held out here and injected by Layer 2 in buildSystemPrompt — that's
    // the whole reason we can't also include the legacy block)
    expect(ctx.fullContext).toContain(SAMPLE_TEXT);
  });

  it('drops legacy brand voice when profile is calibrated with zero samples (Layer 2 covers it)', () => {
    // This is the original bug: a calibrated profile with DNA + guardrails but
    // no samples causes buildVoiceProfileContext to return ''. Pre-fix, the
    // code would use that '' as the effective brand voice — dropping legacy
    // AND providing nothing in its place. Post-fix, we still drop legacy
    // (because status === 'calibrated' means Layer 2 injects DNA + guardrails
    // into the SYSTEM prompt), preventing the model from seeing a contradictory
    // legacy block in the USER prompt alongside calibrated Layer 2 content.
    seeded = seedWorkspaceWithLegacyVoice();
    getOrCreateVoiceProfile(seeded.workspaceId);
    // State machine enforces draft → calibrating → calibrated — cannot skip calibrating.
    updateVoiceProfile(seeded.workspaceId, { status: 'calibrating' });
    updateVoiceProfile(seeded.workspaceId, {
      status: 'calibrated',
      voiceDNA: SENTINEL_DNA,
      guardrails: SENTINEL_GUARDRAILS,
    });
    clearSeoContextCache(seeded.workspaceId);

    const ctx = buildSeoContext(seeded.workspaceId, undefined, 'strategy', { _skipShadow: true });

    // Legacy is NOT in the user-prompt context — calibrated Layer 2 owns voice.
    expect(ctx.fullContext).not.toContain(LEGACY_VOICE_TEXT);
    expect(ctx.brandVoiceBlock).not.toContain(LEGACY_VOICE_TEXT);
  });

  it('preserves legacy brand voice when draft profile has only samples (no DNA, no guardrails)', () => {
    // Regression for the post-PR-#168 review flag: an admin who opens the
    // Voice tab and uploads a single sample should NOT silently lose their
    // previously-configured legacy `workspace.brandVoice` text. Samples
    // alone are "preparing to calibrate" — they express intent to use the
    // new voice system, but the admin hasn't committed to any DNA or
    // guardrails yet. Dropping the legacy block at that moment is a one-way,
    // invisible transition that leaves the prompt noticeably weaker.
    //
    // Post-fix: only calibrated OR explicit DNA/guardrails activate the
    // override. Samples-only drafts keep the legacy block in the prompt.
    seeded = seedWorkspaceWithLegacyVoice();
    getOrCreateVoiceProfile(seeded.workspaceId);
    addVoiceSample(seeded.workspaceId, SAMPLE_TEXT, 'body', 'manual');
    // No DNA, no guardrails, no status change — pure "uploaded one sample".
    clearSeoContextCache(seeded.workspaceId);

    const ctx = buildSeoContext(seeded.workspaceId, undefined, 'strategy', { _skipShadow: true });

    // Legacy MUST still be present — the admin hasn't committed to the new path yet.
    expect(ctx.fullContext).toContain(LEGACY_VOICE_TEXT);
    expect(ctx.brandVoiceBlock).toContain(LEGACY_VOICE_TEXT);
  });

  it('activates override when draft profile has DNA saved (even before calibration)', () => {
    // Symmetric to the samples-only test: once the admin has committed to
    // the new voice system by saving actual DNA (e.g. via the calibration
    // wizard that persists DNA mid-flow), the override DOES activate and
    // the legacy block is dropped. Same for guardrails.
    seeded = seedWorkspaceWithLegacyVoice();
    getOrCreateVoiceProfile(seeded.workspaceId);
    addVoiceSample(seeded.workspaceId, SAMPLE_TEXT, 'body', 'manual');
    updateVoiceProfile(seeded.workspaceId, { voiceDNA: SENTINEL_DNA });
    clearSeoContextCache(seeded.workspaceId);

    const ctx = buildSeoContext(seeded.workspaceId, undefined, 'strategy', { _skipShadow: true });

    // Legacy is gone — the admin's DNA save was the commitment signal.
    expect(ctx.fullContext).not.toContain(LEGACY_VOICE_TEXT);
    // The voice profile block is now active and contains the sample text.
    expect(ctx.fullContext).toContain(SAMPLE_TEXT);
  });
});

/**
 * State-machine guard tests for `updateVoiceProfile`. PR #168 review I5:
 * the admin UI (and any future caller) must never be able to jump a profile
 * directly from `draft` to `calibrated`, because `buildSystemPrompt` layer-2
 * voice injection branches on `status === 'calibrated'` and will emit empty
 * DNA/guardrails blocks if those fields weren't populated during the skipped
 * `calibrating` phase.
 *
 * The guard lives inside `updateVoiceProfile` so every write path — route
 * handler, internal flow, test — flows through it.
 */
describe('updateVoiceProfile — state machine guard', () => {
  let seeded: SeededWs | null = null;

  afterEach(() => {
    seeded?.cleanup();
    seeded = null;
  });

  it('rejects illegal draft → calibrated transition', () => {
    seeded = seedWorkspaceWithLegacyVoice();
    getOrCreateVoiceProfile(seeded.workspaceId); // creates draft

    expect(() =>
      updateVoiceProfile(seeded!.workspaceId, {
        status: 'calibrated',
        voiceDNA: SENTINEL_DNA,
        guardrails: SENTINEL_GUARDRAILS,
      }),
    ).toThrow(VoiceProfileStateTransitionError);
  });

  it('error carries structured from/to fields for 400 response mapping', () => {
    seeded = seedWorkspaceWithLegacyVoice();
    getOrCreateVoiceProfile(seeded.workspaceId);

    try {
      updateVoiceProfile(seeded.workspaceId, { status: 'calibrated' });
      expect.fail('should have thrown VoiceProfileStateTransitionError');
    } catch (err) {
      expect(err).toBeInstanceOf(VoiceProfileStateTransitionError);
      const transitionErr = err as VoiceProfileStateTransitionError;
      expect(transitionErr.from).toBe('draft');
      expect(transitionErr.to).toBe('calibrated');
    }
  });

  it('allows legal draft → calibrating', () => {
    seeded = seedWorkspaceWithLegacyVoice();
    getOrCreateVoiceProfile(seeded.workspaceId);

    const result = updateVoiceProfile(seeded.workspaceId, { status: 'calibrating' });
    expect(result.status).toBe('calibrating');
  });

  it('allows legal calibrating → calibrated', () => {
    seeded = seedWorkspaceWithLegacyVoice();
    getOrCreateVoiceProfile(seeded.workspaceId);
    updateVoiceProfile(seeded.workspaceId, { status: 'calibrating' });

    const result = updateVoiceProfile(seeded.workspaceId, {
      status: 'calibrated',
      voiceDNA: SENTINEL_DNA,
      guardrails: SENTINEL_GUARDRAILS,
    });
    expect(result.status).toBe('calibrated');
  });

  it('allows calibrated → draft reset', () => {
    seeded = seedWorkspaceWithLegacyVoice();
    getOrCreateVoiceProfile(seeded.workspaceId);
    updateVoiceProfile(seeded.workspaceId, { status: 'calibrating' });
    updateVoiceProfile(seeded.workspaceId, {
      status: 'calibrated',
      voiceDNA: SENTINEL_DNA,
      guardrails: SENTINEL_GUARDRAILS,
    });

    const result = updateVoiceProfile(seeded.workspaceId, { status: 'draft' });
    expect(result.status).toBe('draft');
  });

  it('allows same-state no-op updates (no status change)', () => {
    seeded = seedWorkspaceWithLegacyVoice();
    getOrCreateVoiceProfile(seeded.workspaceId);

    // No status in the update — pure field edit. Must not throw.
    const result = updateVoiceProfile(seeded.workspaceId, { voiceDNA: SENTINEL_DNA });
    expect(result.status).toBe('draft');
    expect(result.voiceDNA).toEqual(SENTINEL_DNA);
  });

  it('allows redundant same-status update (draft → draft)', () => {
    seeded = seedWorkspaceWithLegacyVoice();
    getOrCreateVoiceProfile(seeded.workspaceId);

    // Admin UI may send the current status unchanged — must be a legal no-op.
    const result = updateVoiceProfile(seeded.workspaceId, { status: 'draft' });
    expect(result.status).toBe('draft');
  });
});
