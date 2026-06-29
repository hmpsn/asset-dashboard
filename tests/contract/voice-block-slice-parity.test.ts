/**
 * Contract — brand voice block slice parity (brand-slice P4, Option A).
 *
 * Two intelligence-slice fields expose the brand voice block:
 *   - `seoContext.effectiveBrandVoiceBlock` — carried on the always-assembled SEO context
 *     slice because the prompt formatter (`formatSeoContextSection`) receives ONLY that
 *     slice and renders voice as part of the SEO Context section.
 *   - `brand.voicePromptBlock` — carried on the on-demand brand slice for brand-context
 *     consumers (the MCP get_brand_identity / prepare_*_context paths).
 *
 * Both are sourced from the SAME function, `buildEffectiveBrandVoiceBlock(workspaceId)`
 * (the brand slice wraps it in `safeBrandEngineRead`, returning '' only if it throws). So
 * the single source of truth already exists at the function level — these two fields must
 * therefore hold byte-identical values for any given workspace.
 *
 * This test LOCKS that invariant. The voice field was intentionally NOT physically merged
 * (the seoContext copy is load-bearing for the formatter, and folding voice into the brand
 * slice would force brand into `baseSlices` — assembling brand identity on every prompt
 * build and touching the most AI-sensitive code for no correctness gain). Instead we
 * enforce equality here so a future change to one source can't silently drift from the
 * other — a divergence would be invisible to the type checker and would corrupt brand
 * voice in generated content.
 *
 * If this test fails: do NOT "fix" it by editing one field. The two MUST resolve to the
 * same `buildEffectiveBrandVoiceBlock(workspaceId)` output. Re-converge the sources.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';
import { invalidateIntelligenceCache } from '../../server/intelligence/cache-invalidation.js';

const WS_VOICE = 'ws_test_voiceparity_on';
const WS_EMPTY = 'ws_test_voiceparity_off';
const VOICE_TEXT = 'We speak plainly, warmly, and with zero jargon.';

function seedWs(id: string, brandVoice: string | null): void {
  db.prepare(
    `INSERT OR REPLACE INTO workspaces (id, name, folder, brand_voice, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, `Voice Parity ${id}`, `test-${id}`, brandVoice, new Date().toISOString());
  invalidateIntelligenceCache(id);
}

describe('brand voice block slice parity (P4 invariant)', () => {
  beforeEach(() => {
    seedWs(WS_VOICE, VOICE_TEXT);
    seedWs(WS_EMPTY, null);
  });
  afterEach(() => {
    db.prepare('DELETE FROM workspaces WHERE id IN (?, ?)').run(WS_VOICE, WS_EMPTY);
    invalidateIntelligenceCache(WS_VOICE);
    invalidateIntelligenceCache(WS_EMPTY);
  });

  it('exposes byte-identical voice on both slices when the workspace has voice', async () => {
    const intel = await buildWorkspaceIntelligence(WS_VOICE, { slices: ['seoContext', 'brand'] });
    const seoVoice = intel.seoContext?.effectiveBrandVoiceBlock;
    const brandVoice = intel.brand?.voicePromptBlock;

    // Sanity: voice actually resolved from the workspace's brand_voice.
    expect(seoVoice).toBeTruthy();
    expect(seoVoice).toContain('zero jargon');
    // The invariant: the two slice copies are identical.
    expect(brandVoice).toBe(seoVoice);
  });

  it('exposes an identical empty string on both slices when the workspace has no voice', async () => {
    const intel = await buildWorkspaceIntelligence(WS_EMPTY, { slices: ['seoContext', 'brand'] });
    expect(intel.seoContext?.effectiveBrandVoiceBlock).toBe('');
    expect(intel.brand?.voicePromptBlock).toBe('');
    // Still identical in the empty case — the invariant holds across voice states.
    expect(intel.brand?.voicePromptBlock).toBe(intel.seoContext?.effectiveBrandVoiceBlock);
  });
});
