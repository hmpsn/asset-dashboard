// tests/unit/copy-generation-pure.test.ts
// Pure unit tests for copy-generation.ts — runQualityCheck edge cases
// and buildCopyGenerationContext prompt-assembly logic.
//
// Existing coverage: copy-generation-quality.test.ts covers happy-path + one case each for
// forbidden phrase, word count, keyword stuffing, and guardrail violation.
// This file covers boundaries, multiple flags, short words, guardrail format variants,
// AND the context/prompt assembly logic in buildCopyGenerationContext.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SectionPlanItem, SiteBlueprint, BlueprintEntry } from '../../shared/types/page-strategy.js';

// ── Mock all side-effectful dependencies of buildCopyGenerationContext ─────────
// Mocks must be declared before the tested module is imported.

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../server/brandscript.js', () => ({
  listBrandscripts: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/voice-calibration.js', () => ({
  getVoiceProfile: vi.fn().mockReturnValue(null),
  buildVoiceCalibrationContext: vi.fn().mockReturnValue({ samplesText: '', dnaText: '', guardrailsText: '' }),
}));

vi.mock('../../server/brand-identity.js', () => ({
  listDeliverables: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/page-strategy.js', () => ({
  getBlueprint: vi.fn(),
  getEntry: vi.fn(),
  listBlueprints: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/content-brief.js', () => ({
  generateBrief: vi.fn().mockResolvedValue({}),
  getPageTypeConfig: vi.fn().mockReturnValue({
    wordCountRange: '1,000-1,500',
    contentStyle: 'Professional and benefit-driven.',
    prompt: 'PAGE TYPE: Service Page\n- Lead with what the service solves.',
  }),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn().mockResolvedValue({ seoContext: null }),
  formatKeywordsForPrompt: vi.fn().mockReturnValue(''),
  formatPersonasForPrompt: vi.fn().mockReturnValue(''),
  formatKnowledgeBaseForPrompt: vi.fn().mockReturnValue(''),
}));

vi.mock('../../server/copy-intelligence.js', () => ({
  getActivePatterns: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/writing-quality.js', () => ({
  WRITING_QUALITY_RULES: 'MOCK WRITING QUALITY RULES',
  CREATIVE_WRITING_RULES: 'MOCK CREATIVE WRITING RULES',
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: vi.fn((raw: string, fallback: unknown) => {
    try { return JSON.parse(raw); } catch { return fallback; }
  }),
}));

vi.mock('../../server/db/index.js', () => ({
  default: { transaction: vi.fn(), prepare: vi.fn() },
}));

vi.mock('../../server/copy-review.js', () => ({
  initializeSections: vi.fn(),
  saveGeneratedCopy: vi.fn(),
  saveMetadata: vi.fn(),
  addSteeringEntry: vi.fn(),
  getSectionsForEntry: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn(),
}));

vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: vi.fn((_wsId: string, base: string) => base),
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn().mockReturnValue(false),
}));

import {
  runQualityCheck,
  buildCopyGenerationContext,
} from '../../server/copy-generation.js';
import { listBrandscripts } from '../../server/brandscript.js';
import { getVoiceProfile, buildVoiceCalibrationContext } from '../../server/voice-calibration.js';
import { listDeliverables } from '../../server/brand-identity.js';
import { generateBrief, getPageTypeConfig } from '../../server/content-brief.js';
import {
  buildWorkspaceIntelligence,
  formatKeywordsForPrompt,
  formatPersonasForPrompt,
  formatKnowledgeBaseForPrompt,
} from '../../server/workspace-intelligence.js';
import { getActivePatterns } from '../../server/copy-intelligence.js';
import { getSectionsForEntry } from '../../server/copy-review.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_SECTION: SectionPlanItem = {
  id: 'sec-1',
  sectionType: 'hero',
  narrativeRole: 'hook',
  wordCountTarget: 100,
  order: 1,
};

const WORKSPACE_ID = 'ws_copy_gen_test';

function makeBlueprint(overrides: Partial<SiteBlueprint> = {}): SiteBlueprint {
  return {
    id: 'bp-1',
    workspaceId: WORKSPACE_ID,
    name: 'Acme Plumbing Site',
    version: 1,
    status: 'draft',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<BlueprintEntry> = {}): BlueprintEntry {
  return {
    id: 'entry-1',
    blueprintId: 'bp-1',
    name: 'Emergency Plumbing',
    pageType: 'service',
    scope: 'included',
    sortOrder: 0,
    isCollection: false,
    sectionPlan: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Return a string of N plain words (no forbidden phrases or long repeats).
 * Each word is unique (word0, word1, …) so no word ever appears more than once,
 * guaranteeing zero keyword-stuffing flags regardless of N.
 */
function words(n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`word${i}`);
  return out.join(' ');
}

// ── Reset mocks between tests ─────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(listBrandscripts).mockReturnValue([]);
  vi.mocked(getVoiceProfile).mockReturnValue(null);
  vi.mocked(buildVoiceCalibrationContext).mockReturnValue({ samplesText: '', dnaText: '', guardrailsText: '' } as ReturnType<typeof buildVoiceCalibrationContext>);
  vi.mocked(listDeliverables).mockReturnValue([]);
  vi.mocked(getSectionsForEntry).mockReturnValue([]);
  vi.mocked(generateBrief).mockResolvedValue({} as Awaited<ReturnType<typeof generateBrief>>);
  vi.mocked(getPageTypeConfig).mockReturnValue({
    wordCountRange: '1,000-1,500',
    contentStyle: 'Professional and benefit-driven.',
    prompt: 'PAGE TYPE: Service Page\n- Lead with what the service solves.',
  });
  vi.mocked(buildWorkspaceIntelligence).mockResolvedValue({ seoContext: null } as Awaited<ReturnType<typeof buildWorkspaceIntelligence>>);
  vi.mocked(formatKeywordsForPrompt).mockReturnValue('');
  vi.mocked(formatPersonasForPrompt).mockReturnValue('');
  vi.mocked(formatKnowledgeBaseForPrompt).mockReturnValue('');
  vi.mocked(getActivePatterns).mockReturnValue([]);
});

// ── Forbidden phrases ─────────────────────────────────────────────────────────

describe('runQualityCheck — forbidden phrases', () => {
  const forbiddenList = [
    'cutting-edge',
    'seamlessly',
    'leverage',
    'synergy',
    'game-changer',
    'revolutionize',
    'paradigm shift',
    'best-in-class',
    'world-class',
    'game-changing',
    'next-level',
    'unlock the power of',
    'move the needle',
    'deep dive',
    'silver bullet',
    'secret sauce',
  ];

  for (const phrase of forbiddenList) {
    it(`flags "${phrase}"`, () => {
      const copy = `Our solution is ${phrase} for your workflow needs today`;
      const flags = runQualityCheck(copy, BASE_SECTION);
      const phraseFlags = flags.filter(f => f.type === 'forbidden_phrase');
      expect(phraseFlags.length).toBeGreaterThanOrEqual(1);
      expect(phraseFlags.some(f => f.message.toLowerCase().includes(phrase.toLowerCase()))).toBe(true);
    });
  }

  it('produces one flag per forbidden phrase when multiple appear', () => {
    const copy = `This cutting-edge synergy will leverage your team ${words(60)}`;
    const flags = runQualityCheck(copy, BASE_SECTION);
    const phraseFlags = flags.filter(f => f.type === 'forbidden_phrase');
    expect(phraseFlags.length).toBe(3);
  });

  it('is case-insensitive for phrase detection', () => {
    const copy = `Our CUTTING-EDGE platform ${words(80)}`;
    const flags = runQualityCheck(copy, BASE_SECTION);
    expect(flags.some(f => f.type === 'forbidden_phrase' && f.message.includes('cutting-edge'))).toBe(true);
  });

  it('assigns warning severity to forbidden phrase flags', () => {
    const copy = `We seamlessly integrate ${words(80)}`;
    const flags = runQualityCheck(copy, BASE_SECTION);
    const phraseFlag = flags.find(f => f.type === 'forbidden_phrase');
    expect(phraseFlag?.severity).toBe('warning');
  });
});

// ── Word count violations ──────────────────────────────────────────────────────

describe('runQualityCheck — word count', () => {
  it('does not flag when word count is exactly at the lower boundary (50% of target)', () => {
    // target=100, 50% = 50 words → exactly 50 words should NOT be flagged
    const copy = words(50);
    const flags = runQualityCheck(copy, BASE_SECTION);
    expect(flags.some(f => f.type === 'word_count_violation')).toBe(false);
  });

  it('flags when word count is one below the lower boundary (49 of 100)', () => {
    const copy = words(49);
    const flags = runQualityCheck(copy, BASE_SECTION);
    expect(flags.some(f => f.type === 'word_count_violation' && f.message.startsWith('Too short:'))).toBe(true);
  });

  it('does not flag when word count is exactly at the upper boundary (150% of target)', () => {
    // target=100, 150% = 150 words → exactly 150 words should NOT be flagged
    const copy = words(150);
    const flags = runQualityCheck(copy, BASE_SECTION);
    expect(flags.some(f => f.type === 'word_count_violation')).toBe(false);
  });

  it('flags when word count is one above the upper boundary (151 of 100)', () => {
    const copy = words(151);
    const flags = runQualityCheck(copy, BASE_SECTION);
    expect(flags.some(f => f.type === 'word_count_violation' && f.message.startsWith('Too long:'))).toBe(true);
  });

  it('reports the actual word count and target in the message', () => {
    const section: SectionPlanItem = { ...BASE_SECTION, wordCountTarget: 200 };
    const copy = words(50); // 50 < 200 * 0.5 = 100
    const flags = runQualityCheck(copy, section);
    const vcFlag = flags.find(f => f.type === 'word_count_violation');
    expect(vcFlag?.message).toContain('50');
    expect(vcFlag?.message).toContain('200');
  });

  it('skips word count check when sectionPlan has no wordCountTarget', () => {
    const section: SectionPlanItem = { ...BASE_SECTION, wordCountTarget: 0 };
    // 0 is falsy, so no word count check — should not produce word_count_violation
    const copy = words(3);
    const flags = runQualityCheck(copy, section);
    expect(flags.some(f => f.type === 'word_count_violation')).toBe(false);
  });

  it('assigns warning severity to word count violation flags', () => {
    const copy = words(5); // way under 100
    const flags = runQualityCheck(copy, BASE_SECTION);
    const vcFlag = flags.find(f => f.type === 'word_count_violation');
    expect(vcFlag?.severity).toBe('warning');
  });
});

// ── Keyword stuffing ──────────────────────────────────────────────────────────

describe('runQualityCheck — keyword stuffing', () => {
  it('does not flag a word that appears exactly 3 times (below threshold)', () => {
    // Only words with length > 4 are tracked
    const copy = `reporting reporting reporting clear goals for the team ${words(85)}`;
    const flags = runQualityCheck(copy, BASE_SECTION);
    expect(flags.some(f => f.type === 'keyword_stuffing' && f.message.includes('"reporting"'))).toBe(false);
  });

  it('flags a word that appears exactly 4 times (at threshold)', () => {
    const copy = `reporting reporting reporting reporting helps the team ${words(80)}`;
    const flags = runQualityCheck(copy, BASE_SECTION);
    expect(flags.some(f => f.type === 'keyword_stuffing' && f.message.includes('"reporting"'))).toBe(true);
  });

  it('flags a word that appears 5+ times', () => {
    const copy = `reporting reporting reporting reporting reporting ${words(80)}`;
    const flags = runQualityCheck(copy, BASE_SECTION);
    const stuffFlag = flags.find(f => f.type === 'keyword_stuffing' && f.message.includes('"reporting"'));
    expect(stuffFlag?.message).toContain('5 times');
  });

  it('does not flag short words (length ≤ 4) even if they repeat many times', () => {
    // 'the', 'and', 'for', 'you', 'can', 'our' — all ≤4 chars — should never trigger
    const copy = `the the the the the the the ${words(80)}`;
    const flags = runQualityCheck(copy, BASE_SECTION);
    expect(flags.some(f => f.type === 'keyword_stuffing' && f.message.includes('"the"'))).toBe(false);
  });

  it('does not flag a word exactly at the 4-char length boundary (length 4, ≤4 → skipped)', () => {
    // "data" has length 4 — 4 is NOT > 4, so it should be excluded from frequency counting
    const copy = `data data data data data ${words(85)}`;
    const flags = runQualityCheck(copy, BASE_SECTION);
    expect(flags.some(f => f.type === 'keyword_stuffing' && f.message.includes('"data"'))).toBe(false);
  });

  it('flags a 5-char word repeated 4 times (length 5 > 4, triggers counting)', () => {
    // "teams" has length 5
    const copy = `teams teams teams teams help with the project scope ${words(80)}`;
    const flags = runQualityCheck(copy, BASE_SECTION);
    expect(flags.some(f => f.type === 'keyword_stuffing' && f.message.includes('"teams"'))).toBe(true);
  });

  it('assigns warning severity to keyword stuffing flags', () => {
    const copy = `reporting reporting reporting reporting ${words(80)}`;
    const flags = runQualityCheck(copy, BASE_SECTION);
    const stuffFlag = flags.find(f => f.type === 'keyword_stuffing');
    expect(stuffFlag?.severity).toBe('warning');
  });

  it('can flag multiple different words in the same copy', () => {
    const copy = `reporting reporting reporting reporting analysis analysis analysis analysis ${words(60)}`;
    const flags = runQualityCheck(copy, BASE_SECTION);
    const stuffFlags = flags.filter(f => f.type === 'keyword_stuffing');
    expect(stuffFlags.length).toBe(2);
  });
});

// ── Guardrail violations ───────────────────────────────────────────────────────

describe('runQualityCheck — guardrail violations', () => {
  it('does not produce guardrail flags when guardrailsText has no "Never use:" line', () => {
    const guardrails = 'Always be clear. Avoid jargon. Write for your audience.';
    const flags = runQualityCheck(`Clear helpful writing for the audience ${words(80)}`, BASE_SECTION, guardrails);
    expect(flags.some(f => f.type === 'guardrail_violation')).toBe(false);
  });

  it('extracts terms after "Never use:" and flags each match', () => {
    const guardrails = 'Never use: flimsy, cheap, inferior';
    const copy = `This cheap product has a flimsy build that feels inferior ${words(75)}`;
    const flags = runQualityCheck(copy, BASE_SECTION, guardrails);
    const vflags = flags.filter(f => f.type === 'guardrail_violation');
    expect(vflags.length).toBe(3);
    expect(vflags.some(f => f.message.includes('"flimsy"'))).toBe(true);
    expect(vflags.some(f => f.message.includes('"cheap"'))).toBe(true);
    expect(vflags.some(f => f.message.includes('"inferior"'))).toBe(true);
  });

  it('guardrail check is case-insensitive', () => {
    const guardrails = 'Never use: effortless';
    const copy = `It is EFFORTLESS to set up ${words(85)}`;
    const flags = runQualityCheck(copy, BASE_SECTION, guardrails);
    expect(flags.some(f => f.type === 'guardrail_violation' && f.message.includes('"effortless"'))).toBe(true);
  });

  it('assigns error severity to guardrail violation flags', () => {
    const guardrails = 'Never use: guaranteed';
    const copy = `Results are guaranteed for every client ${words(80)}`;
    const flags = runQualityCheck(copy, BASE_SECTION, guardrails);
    const vflag = flags.find(f => f.type === 'guardrail_violation');
    expect(vflag?.severity).toBe('error');
  });

  it('does not flag a term that is not present in the copy', () => {
    const guardrails = 'Never use: guaranteed, instant';
    const copy = `We deliver reliable results over time ${words(85)}`;
    const flags = runQualityCheck(copy, BASE_SECTION, guardrails);
    expect(flags.some(f => f.type === 'guardrail_violation')).toBe(false);
  });

  it('handles "Never use:" match case-insensitively in the guardrailsText itself', () => {
    // The regex is /Never use:\s*(.+)/i so "NEVER USE:" should also match
    const guardrails = 'NEVER USE: shoddy, broken';
    const copy = `This shoddy craftsmanship shows ${words(85)}`;
    const flags = runQualityCheck(copy, BASE_SECTION, guardrails);
    expect(flags.some(f => f.type === 'guardrail_violation' && f.message.includes('"shoddy"'))).toBe(true);
  });
});

// ── Multiple simultaneous flag types ─────────────────────────────────────────

describe('runQualityCheck — multiple simultaneous flag types', () => {
  it('can produce forbidden_phrase + keyword_stuffing flags in the same pass', () => {
    // Short copy: forbidden phrase + keyword stuffing (no word count issue since no target)
    const section: SectionPlanItem = { ...BASE_SECTION, wordCountTarget: 0 };
    const copy = `Our cutting-edge reporting reporting reporting reporting approach`;
    const flags = runQualityCheck(copy, section);
    expect(flags.some(f => f.type === 'forbidden_phrase')).toBe(true);
    expect(flags.some(f => f.type === 'keyword_stuffing')).toBe(true);
  });

  it('can produce all three flag types in a single copy', () => {
    // word count violation (too short) + forbidden phrase + keyword stuffing
    const section: SectionPlanItem = { ...BASE_SECTION, wordCountTarget: 200 };
    const copy = `Our cutting-edge reporting reporting reporting reporting approach`;
    const flags = runQualityCheck(copy, section);
    expect(flags.some(f => f.type === 'word_count_violation')).toBe(true);
    expect(flags.some(f => f.type === 'forbidden_phrase')).toBe(true);
    expect(flags.some(f => f.type === 'keyword_stuffing')).toBe(true);
  });

  it('returns an empty array for perfectly clean copy at the right length', () => {
    const copy = words(100);
    const flags = runQualityCheck(copy, BASE_SECTION);
    expect(flags).toEqual([]);
  });

  it('returns an empty array for empty string when no wordCountTarget', () => {
    const section: SectionPlanItem = { ...BASE_SECTION, wordCountTarget: 0 };
    const flags = runQualityCheck('', section);
    expect(flags).toEqual([]);
  });
});

// ── buildCopyGenerationContext — PAGE STRATEGY layer ─────────────────────────

describe('buildCopyGenerationContext — PAGE STRATEGY layer', () => {
  it('always includes the site name in the PAGE STRATEGY block', async () => {
    const blueprint = makeBlueprint({ name: 'My Test Site' });
    const entry = makeEntry();
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).toContain('PAGE STRATEGY:');
    expect(ctx).toContain('Site: My Test Site');
  });

  it('includes industryType in site line when present', async () => {
    const blueprint = makeBlueprint({ name: 'Acme', industryType: 'plumbing' });
    const entry = makeEntry();
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).toContain('Site: Acme (plumbing)');
  });

  it('omits industry type parenthetical when industryType is absent', async () => {
    const blueprint = makeBlueprint({ name: 'Acme', industryType: undefined });
    const entry = makeEntry();
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).toContain('Site: Acme');
    expect(ctx).not.toContain('(undefined)');
  });

  it('includes primary keyword when provided', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({ primaryKeyword: 'emergency plumber' });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).toContain('Primary keyword: emergency plumber');
  });

  it('omits primary keyword line when not provided', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({ primaryKeyword: undefined });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).not.toContain('Primary keyword:');
  });

  it('includes secondary keywords as a comma-joined list', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({ secondaryKeywords: ['drain repair', 'pipe replacement'] });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).toContain('Secondary keywords: drain repair, pipe replacement');
  });

  it('omits secondary keywords line when array is empty', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({ secondaryKeywords: [] });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).not.toContain('Secondary keywords:');
  });

  it('includes entry page type', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({ pageType: 'landing' });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).toContain('Page type: landing');
  });

  it('includes entry notes when provided', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({ notes: 'Focus on 24/7 availability' });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).toContain('Entry notes: Focus on 24/7 availability');
  });

  it('omits entry notes line when notes are absent', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({ notes: undefined });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).not.toContain('Entry notes:');
  });
});

// ── buildCopyGenerationContext — section plan formatting ──────────────────────

describe('buildCopyGenerationContext — section plan formatting', () => {
  it('formats section plan items with their ID, type, and role', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({
      sectionPlan: [
        { id: 'sp-hero', sectionType: 'hero', narrativeRole: 'hook', wordCountTarget: 120, order: 0 },
      ],
    });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).toContain('[sp-hero] hero — hook (120 words)');
  });

  it('formats section plan without narrativeRole when absent', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({
      sectionPlan: [
        { id: 'sp-cta', sectionType: 'cta', wordCountTarget: 50, order: 1 },
      ],
    });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    // No narrativeRole — no "— " dash separator
    expect(ctx).toContain('[sp-cta] cta (50 words)');
    expect(ctx).not.toContain('[sp-cta] cta — ');
  });

  it('includes brandNote in section plan item when present', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({
      sectionPlan: [
        { id: 'sp-intro', sectionType: 'intro', narrativeRole: 'hook', wordCountTarget: 80, order: 0, brandNote: 'Lead with empathy' },
      ],
    });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).toContain('brand: Lead with empathy');
  });

  it('includes seoNote in section plan item when present', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({
      sectionPlan: [
        { id: 'sp-intro', sectionType: 'intro', wordCountTarget: 80, order: 0, seoNote: 'Include primary keyword in H1' },
      ],
    });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).toContain('seo: Include primary keyword in H1');
  });

  it('omits brandNote and seoNote fields when absent', async () => {
    const blueprint = makeBlueprint();
    const entry = makeEntry({
      sectionPlan: [
        { id: 'sp-body', sectionType: 'content-body', wordCountTarget: 200, order: 0 },
      ],
    });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, blueprint, entry);
    expect(ctx).not.toContain('brand:');
    expect(ctx).not.toContain('seo:');
  });
});

// ── buildCopyGenerationContext — accumulated steering ────────────────────────

describe('buildCopyGenerationContext — accumulated steering', () => {
  it('omits the steering block when accumulatedSteering is undefined', async () => {
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).not.toContain('ACCUMULATED STEERING');
  });

  it('omits the steering block when accumulatedSteering is an empty array', async () => {
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry(), []);
    expect(ctx).not.toContain('ACCUMULATED STEERING');
  });

  it('includes numbered steering notes when provided', async () => {
    const steering = ['Use warmer tone', 'Lead with outcomes not features'];
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry(), steering);
    expect(ctx).toContain('ACCUMULATED STEERING');
    expect(ctx).toContain('1. Use warmer tone');
    expect(ctx).toContain('2. Lead with outcomes not features');
  });

  it('numbers steering notes starting from 1', async () => {
    const steering = ['First note', 'Second note', 'Third note'];
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry(), steering);
    expect(ctx).toContain('1. First note');
    expect(ctx).toContain('2. Second note');
    expect(ctx).toContain('3. Third note');
  });
});

// ── buildCopyGenerationContext — layer separator and structure ────────────────

describe('buildCopyGenerationContext — output structure', () => {
  it('joins layers with the "---" separator', async () => {
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    // The PAGE STRATEGY layer is always present; GENERATION RULES always present
    // so at minimum one separator must appear
    expect(ctx).toContain('\n\n---\n\n');
  });

  it('always includes the GENERATION RULES layer', async () => {
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).toContain('GENERATION RULES:');
  });

  it('includes page type word count range from getPageTypeConfig', async () => {
    vi.mocked(getPageTypeConfig).mockReturnValueOnce({
      wordCountRange: '800-1,200',
      contentStyle: 'Punchy and conversion-focused.',
      prompt: 'PAGE TYPE: Landing Page\n- Lead with value prop.',
    });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry({ pageType: 'landing' }));
    expect(ctx).toContain('Word count range: 800-1,200');
  });

  it('includes page type content style from getPageTypeConfig', async () => {
    vi.mocked(getPageTypeConfig).mockReturnValueOnce({
      wordCountRange: '1,500-2,500',
      contentStyle: 'Educational and engaging.',
      prompt: 'PAGE TYPE: Blog Post',
    });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry({ pageType: 'blog' }));
    expect(ctx).toContain('Content style: Educational and engaging.');
  });

  it('includes the page-type-specific prompt from getPageTypeConfig', async () => {
    vi.mocked(getPageTypeConfig).mockReturnValueOnce({
      wordCountRange: '1,000-1,500',
      contentStyle: 'Professional.',
      prompt: 'PAGE TYPE: Service Page\n- Lead with what the service solves.',
    });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).toContain('PAGE TYPE: Service Page');
  });

  it('includes lean creative writing rules in generation layer', async () => {
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).toContain('MOCK CREATIVE WRITING RULES');
    expect(ctx).not.toContain('MOCK WRITING QUALITY RULES');
  });

  it('includes the brand context priority hierarchy in generation rules', async () => {
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).toContain('BRAND CONTEXT PRIORITY');
    expect(ctx).toContain('Page type, conversion goal, and word budget outrank style preferences');
    expect(ctx).toContain('do not expand the page because more brand context is available');
  });

  it('includes service page density contract in generation rules', async () => {
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry({ pageType: 'service' }));
    expect(ctx).toContain('PAGE-TYPE COPY CONTRACT (service)');
    expect(ctx).toContain('Conversion-dense service page, not a long educational article');
    expect(ctx).toContain('Do not add duplicate booking/discovery sections');
  });
});

// ── buildCopyGenerationContext — graceful degradation ────────────────────────

describe('buildCopyGenerationContext — graceful degradation', () => {
  it('still returns a valid context when listBrandscripts throws', async () => {
    vi.mocked(listBrandscripts).mockImplementationOnce(() => { throw new Error('no brandscript table'); });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).toContain('PAGE STRATEGY:');
    expect(ctx).toContain('GENERATION RULES:');
  });

  it('still returns a valid context when getVoiceProfile throws', async () => {
    vi.mocked(getVoiceProfile).mockImplementationOnce(() => { throw new Error('no voice_profiles table'); });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).toContain('PAGE STRATEGY:');
    expect(ctx).toContain('GENERATION RULES:');
  });

  it('still returns a valid context when listDeliverables throws', async () => {
    vi.mocked(listDeliverables).mockImplementationOnce(() => { throw new Error('no brand_identity table'); });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).toContain('PAGE STRATEGY:');
  });

  it('still returns a valid context when buildWorkspaceIntelligence rejects', async () => {
    vi.mocked(buildWorkspaceIntelligence).mockRejectedValueOnce(new Error('intelligence error'));
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).toContain('PAGE STRATEGY:');
    expect(ctx).toContain('GENERATION RULES:');
  });

  it('still returns a valid context when getActivePatterns throws', async () => {
    vi.mocked(getActivePatterns).mockImplementationOnce(() => { throw new Error('no copy_intelligence table'); });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).toContain('PAGE STRATEGY:');
    expect(ctx).toContain('GENERATION RULES:');
  });

  it('skips brief enrichment and continues when generateBrief rejects', async () => {
    vi.mocked(generateBrief).mockRejectedValueOnce(new Error('brief generation failed'));
    const entry = makeEntry({ primaryKeyword: 'emergency plumber' });
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), entry);
    // Should still complete; brief block absent
    expect(ctx).not.toContain('CONTENT BRIEF ENRICHMENT');
    expect(ctx).toContain('PAGE STRATEGY:');
  });
});

// ── buildCopyGenerationContext — brand layers ─────────────────────────────────

describe('buildCopyGenerationContext — brand layers', () => {
  it('includes brand foundation when brandscripts have filled sections', async () => {
    vi.mocked(listBrandscripts).mockReturnValueOnce([
      {
        id: 'bs-1',
        workspaceId: WORKSPACE_ID,
        frameworkType: 'storybrand',
        status: 'draft',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        sections: [
          { id: 's1', brandscriptId: 'bs-1', sectionKey: 'hero', title: 'Hero', content: 'We help homeowners fix plumbing fast', order: 0 },
        ],
      },
    ] as ReturnType<typeof listBrandscripts>);

    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).toContain('BRAND FOUNDATION (storybrand)');
    expect(ctx).toContain('Hero: We help homeowners fix plumbing fast');
  });

  it('omits brand foundation when no brandscripts exist', async () => {
    vi.mocked(listBrandscripts).mockReturnValueOnce([]);
    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).not.toContain('BRAND FOUNDATION');
  });

  it('includes only approved brand identity deliverables', async () => {
    vi.mocked(listDeliverables).mockReturnValueOnce([
      {
        id: 'del-1',
        workspaceId: WORKSPACE_ID,
        deliverableType: 'tagline',
        content: 'Plumbing solved, fast.',
        status: 'approved',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'del-2',
        workspaceId: WORKSPACE_ID,
        deliverableType: 'mission',
        content: 'Draft mission statement',
        status: 'draft', // should be excluded
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ] as ReturnType<typeof listDeliverables>);

    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).toContain('BRAND IDENTITY DELIVERABLES');
    expect(ctx).toContain('[tagline] Plumbing solved, fast.');
    expect(ctx).not.toContain('Draft mission statement');
  });

  it('omits brand identity block when no approved deliverables exist', async () => {
    vi.mocked(listDeliverables).mockReturnValueOnce([
      { id: 'del-1', workspaceId: WORKSPACE_ID, deliverableType: 'tagline', content: 'Draft tagline', status: 'draft', createdAt: '', updatedAt: '' },
    ] as ReturnType<typeof listDeliverables>);

    const ctx = await buildCopyGenerationContext(WORKSPACE_ID, makeBlueprint(), makeEntry());
    expect(ctx).not.toContain('BRAND IDENTITY DELIVERABLES');
  });
});
