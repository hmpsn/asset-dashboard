import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import {
  voiceDNAToPromptInstructions,
  guardrailsToPromptInstructions,
  buildSystemPrompt,
  buildSystemPromptFromAuthority,
  getCustomPromptNotes,
} from '../../server/prompt-assembly.js';
import type { VoiceDNA, VoiceGuardrails } from '../../shared/types/brand-engine.js';
import { PROSE_QUALITY_RULES } from '../../server/writing-quality.js';

let ws: SeededFullWorkspace;
beforeAll(() => {
  ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
});
afterAll(() => {
  ws?.cleanup();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDNA(overrides: Partial<VoiceDNA> & { formal_casual?: number; serious_playful?: number; technical_accessible?: number } = {}): VoiceDNA {
  const { formal_casual = 5, serious_playful = 5, technical_accessible = 5, ...rest } = overrides;
  return {
    personalityTraits: [],
    toneSpectrum: { formal_casual, serious_playful, technical_accessible },
    sentenceStyle: 'Short punchy lines',
    vocabularyLevel: 'Conversational',
    ...rest,
  };
}

function makeGuardrails(overrides: Partial<VoiceGuardrails> = {}): VoiceGuardrails {
  return {
    forbiddenWords: [],
    requiredTerminology: [],
    toneBoundaries: [],
    antiPatterns: [],
    ...overrides,
  };
}

function insertVoiceProfile(workspaceId: string, status: string, dna: VoiceDNA | null, guardrails: VoiceGuardrails | null): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO voice_profiles (id, workspace_id, status, voice_dna_json, guardrails_json, context_modifiers_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    workspaceId,
    status,
    dna !== null ? JSON.stringify(dna) : null,
    guardrails !== null ? JSON.stringify(guardrails) : null,
    now,
    now,
  );
  return id;
}

function deleteVoiceProfile(workspaceId: string): void {
  db.prepare('DELETE FROM voice_profiles WHERE workspace_id = ?').run(workspaceId);
}

// ─── voiceDNAToPromptInstructions ───────────────────────────────────────────

describe('voiceDNAToPromptInstructions', () => {
  describe('formal_casual tone spectrum', () => {
    it('value >= 7 → conversational and casual', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ formal_casual: 8 }));
      expect(result).toContain('conversational and casual');
    });

    it('exactly 7 → conversational and casual (boundary)', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ formal_casual: 7 }));
      expect(result).toContain('conversational and casual');
    });

    it('value <= 3 → formal and professional', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ formal_casual: 2 }));
      expect(result).toContain('formal and professional');
    });

    it('exactly 3 → formal and professional (boundary)', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ formal_casual: 3 }));
      expect(result).toContain('formal and professional');
    });

    it('value 4 (middle) → professional but approachable', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ formal_casual: 4 }));
      expect(result).toContain('professional but approachable');
    });

    it('value 5 (middle) → professional but approachable', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ formal_casual: 5 }));
      expect(result).toContain('professional but approachable');
    });

    it('value 6 (between 3 and 7) → professional but approachable', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ formal_casual: 6 }));
      expect(result).toContain('professional but approachable');
    });
  });

  describe('serious_playful tone spectrum', () => {
    it('value >= 7 → playful — humor welcome', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ serious_playful: 9 }));
      expect(result).toContain('playful — humor welcome');
    });

    it('exactly 7 → playful — humor welcome (boundary)', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ serious_playful: 7 }));
      expect(result).toContain('playful — humor welcome');
    });

    it('value <= 3 → serious — no jokes', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ serious_playful: 1 }));
      expect(result).toContain('serious — no jokes');
    });

    it('exactly 3 → serious — no jokes (boundary)', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ serious_playful: 3 }));
      expect(result).toContain('serious — no jokes');
    });

    it('value 4 (middle) → measured — light warmth only', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ serious_playful: 4 }));
      expect(result).toContain('measured — light warmth only');
    });

    it('value 5 (middle) → measured — light warmth only', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ serious_playful: 5 }));
      expect(result).toContain('measured — light warmth only');
    });

    it('value 6 (between 3 and 7) → measured — light warmth only', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ serious_playful: 6 }));
      expect(result).toContain('measured — light warmth only');
    });
  });

  describe('technical_accessible tone spectrum', () => {
    it('value >= 7 → plain language — avoid jargon', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ technical_accessible: 8 }));
      expect(result).toContain('plain language — avoid jargon');
    });

    it('exactly 7 → plain language — avoid jargon (boundary)', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ technical_accessible: 7 }));
      expect(result).toContain('plain language — avoid jargon');
    });

    it('value <= 3 → technical — assume domain expertise', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ technical_accessible: 2 }));
      expect(result).toContain('technical — assume domain expertise');
    });

    it('exactly 3 → technical — assume domain expertise (boundary)', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ technical_accessible: 3 }));
      expect(result).toContain('technical — assume domain expertise');
    });

    it('value 4 (middle) → balanced — define terms where helpful', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ technical_accessible: 4 }));
      expect(result).toContain('balanced — define terms where helpful');
    });

    it('value 5 (middle) → balanced — define terms where helpful', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ technical_accessible: 5 }));
      expect(result).toContain('balanced — define terms where helpful');
    });

    it('value 6 (between 3 and 7) → balanced — define terms where helpful', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ technical_accessible: 6 }));
      expect(result).toContain('balanced — define terms where helpful');
    });
  });

  describe('humorStyle field', () => {
    it('humorStyle present → included in output', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ humorStyle: 'Self-deprecating' }));
      expect(result).toContain('Self-deprecating');
      expect(result).toContain('Humor:');
    });

    it('humorStyle absent (undefined) → not included in output', () => {
      const dna = makeDNA();
      delete dna.humorStyle;
      const result = voiceDNAToPromptInstructions(dna);
      expect(result).not.toContain('Humor:');
    });

    it('humorStyle empty string → not included in output', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ humorStyle: '' }));
      expect(result).not.toContain('Humor:');
    });
  });

  describe('personalityTraits field', () => {
    it('non-empty personalityTraits → included joined with ", "', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ personalityTraits: ['Witty', 'Warm', 'Direct'] }));
      expect(result).toContain('Witty, Warm, Direct');
      expect(result).toContain('Personality:');
    });

    it('empty personalityTraits → not included in output', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ personalityTraits: [] }));
      expect(result).not.toContain('Personality:');
    });
  });

  describe('always-present fields', () => {
    it('output contains "Voice profile for this client:"', () => {
      const result = voiceDNAToPromptInstructions(makeDNA());
      expect(result).toContain('Voice profile for this client:');
    });

    it('output contains sentenceStyle', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ sentenceStyle: 'Punchy lines' }));
      expect(result).toContain('Punchy lines');
    });

    it('output contains vocabularyLevel', () => {
      const result = voiceDNAToPromptInstructions(makeDNA({ vocabularyLevel: '8th grade reading' }));
      expect(result).toContain('8th grade reading');
    });
  });
});

// ─── guardrailsToPromptInstructions ─────────────────────────────────────────

describe('guardrailsToPromptInstructions', () => {
  it('empty arrays for all fields → output is just "Voice guardrails:"', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails());
    expect(result).toBe('Voice guardrails:');
  });

  it('forbiddenWords present → "Never use: word1, word2"', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({ forbiddenWords: ['synergy', 'leverage'] }));
    expect(result).toContain('Never use: synergy, leverage');
  });

  it('forbiddenWords empty → "Never use:" line absent', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({ forbiddenWords: [] }));
    expect(result).not.toContain('Never use:');
  });

  it('requiredTerminology → formatted as "use" (not "insteadOf")', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({
      requiredTerminology: [
        { use: 'team members', insteadOf: 'employees' },
        { use: 'clients', insteadOf: 'customers' },
      ],
    }));
    expect(result).toContain('"team members" (not "employees")');
    expect(result).toContain('"clients" (not "customers")');
    expect(result).toContain('Preferred terms:');
  });

  it('requiredTerminology empty → "Preferred terms:" line absent', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({ requiredTerminology: [] }));
    expect(result).not.toContain('Preferred terms:');
  });

  it('toneBoundaries present → joined with "; "', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({ toneBoundaries: ['No aggressive language', 'Stay empathetic'] }));
    expect(result).toContain('Tone boundaries: No aggressive language; Stay empathetic');
  });

  it('toneBoundaries empty → "Tone boundaries:" line absent', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({ toneBoundaries: [] }));
    expect(result).not.toContain('Tone boundaries:');
  });

  it('antiPatterns present → joined with "; "', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({ antiPatterns: ['Fear tactics', 'Jargon overload'] }));
    expect(result).toContain('Avoid: Fear tactics; Jargon overload');
  });

  it('antiPatterns empty → "Avoid:" line absent', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({ antiPatterns: [] }));
    expect(result).not.toContain('Avoid:');
  });

  it('all fields populated → all sections present', () => {
    const result = guardrailsToPromptInstructions(makeGuardrails({
      forbiddenWords: ['utilize'],
      requiredTerminology: [{ use: 'partner', insteadOf: 'vendor' }],
      toneBoundaries: ['Stay positive'],
      antiPatterns: ['Overuse exclamation'],
    }));
    expect(result).toContain('Voice guardrails:');
    expect(result).toContain('Never use:');
    expect(result).toContain('Preferred terms:');
    expect(result).toContain('Tone boundaries:');
    expect(result).toContain('Avoid:');
  });
});

// ─── buildSystemPrompt ───────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  describe('base instructions (Layer 1)', () => {
    it('base instructions always appear first in output', () => {
      const result = buildSystemPrompt(ws.workspaceId, 'My base instructions');
      expect(result.startsWith('My base instructions')).toBe(true);
    });

    it('base instructions always included regardless of other layers', () => {
      const result = buildSystemPrompt(ws.workspaceId, 'BASE CONTENT');
      expect(result).toContain('BASE CONTENT');
    });
  });

  describe('Layer 2 — voice DNA injection', () => {
    let voiceWs: SeededFullWorkspace;
    beforeAll(() => {
      voiceWs = seedWorkspace({ tier: 'growth', clientPassword: '' });
    });
    afterAll(() => {
      deleteVoiceProfile(voiceWs.workspaceId);
      voiceWs?.cleanup();
    });

    it('status "calibrated" with valid voice_dna_json → voice instructions in output', () => {
      const dna = makeDNA({ formal_casual: 8, personalityTraits: ['Bold'] });
      insertVoiceProfile(voiceWs.workspaceId, 'calibrated', dna, null);
      const result = buildSystemPrompt(voiceWs.workspaceId, 'Base');
      expect(result).toContain('Voice profile for this client:');
      expect(result).toContain('conversational and casual');
    });

    it('status "draft" → voice instructions NOT in output', () => {
      deleteVoiceProfile(voiceWs.workspaceId);
      const dna = makeDNA({ formal_casual: 8 });
      insertVoiceProfile(voiceWs.workspaceId, 'draft', dna, null);
      const result = buildSystemPrompt(voiceWs.workspaceId, 'Base');
      expect(result).not.toContain('Voice profile for this client:');
    });

    it('status "calibrating" → voice instructions NOT in output', () => {
      deleteVoiceProfile(voiceWs.workspaceId);
      const dna = makeDNA({ formal_casual: 8 });
      insertVoiceProfile(voiceWs.workspaceId, 'calibrating', dna, null);
      const result = buildSystemPrompt(voiceWs.workspaceId, 'Base');
      expect(result).not.toContain('Voice profile for this client:');
    });

    it('status "calibrated" but voice_dna_json is NULL → no voice instructions, no crash', () => {
      deleteVoiceProfile(voiceWs.workspaceId);
      insertVoiceProfile(voiceWs.workspaceId, 'calibrated', null, null);
      expect(() => buildSystemPrompt(voiceWs.workspaceId, 'Base')).not.toThrow();
      const result = buildSystemPrompt(voiceWs.workspaceId, 'Base');
      expect(result).not.toContain('Voice profile for this client:');
    });

    it('guardrails_json present + calibrated → guardrails included in output', () => {
      deleteVoiceProfile(voiceWs.workspaceId);
      const dna = makeDNA();
      const guardrails = makeGuardrails({ forbiddenWords: ['synergy'] });
      insertVoiceProfile(voiceWs.workspaceId, 'calibrated', dna, guardrails);
      const result = buildSystemPrompt(voiceWs.workspaceId, 'Base');
      expect(result).toContain('Voice guardrails:');
      expect(result).toContain('Never use: synergy');
    });

    it('workspace with no voice_profiles row → no voice instructions, no crash', () => {
      const noProfileWs = seedWorkspace({ clientPassword: '' });
      try {
        expect(() => buildSystemPrompt(noProfileWs.workspaceId, 'Base')).not.toThrow();
        const result = buildSystemPrompt(noProfileWs.workspaceId, 'Base');
        expect(result).not.toContain('Voice profile for this client:');
      } finally {
        noProfileWs.cleanup();
      }
    });
  });

  describe('Layer 3 — custom notes', () => {
    it('workspace with custom_prompt_notes set → notes appear in output', () => {
      db.prepare('UPDATE workspaces SET custom_prompt_notes = ? WHERE id = ?').run('Test client notes', ws.workspaceId);
      const result = buildSystemPrompt(ws.workspaceId, 'Base');
      expect(result).toContain('Test client notes');
      expect(result).toContain('Additional context for this client:');
      // reset
      db.prepare('UPDATE workspaces SET custom_prompt_notes = NULL WHERE id = ?').run(ws.workspaceId);
    });

    it('workspace with no custom_prompt_notes → notes section absent', () => {
      db.prepare('UPDATE workspaces SET custom_prompt_notes = NULL WHERE id = ?').run(ws.workspaceId);
      const result = buildSystemPrompt(ws.workspaceId, 'Base');
      expect(result).not.toContain('Additional context for this client:');
    });

    it('customNotes arg pre-supplied → used directly in output', () => {
      // Don't set DB notes — the pre-supplied value should be used
      db.prepare('UPDATE workspaces SET custom_prompt_notes = NULL WHERE id = ?').run(ws.workspaceId);
      const result = buildSystemPrompt(ws.workspaceId, 'Base', 'Pre-fetched notes value');
      expect(result).toContain('Pre-fetched notes value');
      expect(result).toContain('Additional context for this client:');
    });

    it('customNotes = null → notes section absent', () => {
      const result = buildSystemPrompt(ws.workspaceId, 'Base', null);
      expect(result).not.toContain('Additional context for this client:');
    });

    it('customNotes arg overrides DB value when both present', () => {
      db.prepare('UPDATE workspaces SET custom_prompt_notes = ? WHERE id = ?').run('DB notes value', ws.workspaceId);
      const result = buildSystemPrompt(ws.workspaceId, 'Base', 'Arg notes value');
      expect(result).toContain('Arg notes value');
      expect(result).not.toContain('DB notes value');
      // reset
      db.prepare('UPDATE workspaces SET custom_prompt_notes = NULL WHERE id = ?').run(ws.workspaceId);
    });
  });

  describe('Layer 4 — prose quality rules', () => {
    it('default (no opts) → PROSE_QUALITY_RULES text in output', () => {
      const result = buildSystemPrompt(ws.workspaceId, 'Base');
      expect(result).toContain(PROSE_QUALITY_RULES.trim());
    });

    it('skipProseRules: true → PROSE_QUALITY_RULES NOT in output', () => {
      const result = buildSystemPrompt(ws.workspaceId, 'Base', undefined, { skipProseRules: true });
      expect(result).not.toContain(PROSE_QUALITY_RULES.trim());
    });

    it('skipProseRules: false → PROSE_QUALITY_RULES IS in output', () => {
      const result = buildSystemPrompt(ws.workspaceId, 'Base', undefined, { skipProseRules: false });
      expect(result).toContain(PROSE_QUALITY_RULES.trim());
    });
  });

  describe('layer join order', () => {
    let layerWs: SeededFullWorkspace;
    beforeAll(() => {
      layerWs = seedWorkspace({ clientPassword: '' });
    });
    afterAll(() => {
      deleteVoiceProfile(layerWs.workspaceId);
      db.prepare('UPDATE workspaces SET custom_prompt_notes = NULL WHERE id = ?').run(layerWs.workspaceId);
      layerWs?.cleanup();
    });

    it('layers appear in order: base → voice → notes → prose', () => {
      const dna = makeDNA({ formal_casual: 8 });
      insertVoiceProfile(layerWs.workspaceId, 'calibrated', dna, null);
      db.prepare('UPDATE workspaces SET custom_prompt_notes = ? WHERE id = ?').run('Client notes here', layerWs.workspaceId);

      const result = buildSystemPrompt(layerWs.workspaceId, 'BASE INSTRUCTIONS');

      const baseIdx = result.indexOf('BASE INSTRUCTIONS');
      const voiceIdx = result.indexOf('Voice profile for this client:');
      const notesIdx = result.indexOf('Client notes here');
      const proseIdx = result.indexOf(PROSE_QUALITY_RULES.trim());

      expect(baseIdx).toBeLessThan(voiceIdx);
      expect(voiceIdx).toBeLessThan(notesIdx);
      expect(notesIdx).toBeLessThan(proseIdx);
    });

    it('layers separated by double newline', () => {
      const result = buildSystemPrompt(layerWs.workspaceId, 'BASE');
      // Parts are joined with '\n\n'
      expect(result).toContain('\n\n');
    });
  });
});

// ─── getCustomPromptNotes ────────────────────────────────────────────────────

describe('getCustomPromptNotes', () => {
  beforeAll(() => {
    db.prepare('UPDATE workspaces SET custom_prompt_notes = NULL WHERE id = ?').run(ws.workspaceId);
  });

  it('returns trimmed string when custom_prompt_notes is set', () => {
    db.prepare('UPDATE workspaces SET custom_prompt_notes = ? WHERE id = ?').run('  Hello notes  ', ws.workspaceId);
    const result = getCustomPromptNotes(ws.workspaceId);
    expect(result).toBe('Hello notes');
  });

  it('returns null when custom_prompt_notes is NULL', () => {
    db.prepare('UPDATE workspaces SET custom_prompt_notes = NULL WHERE id = ?').run(ws.workspaceId);
    const result = getCustomPromptNotes(ws.workspaceId);
    expect(result).toBeNull();
  });

  it('returns null when custom_prompt_notes is empty string', () => {
    db.prepare('UPDATE workspaces SET custom_prompt_notes = ? WHERE id = ?').run('', ws.workspaceId);
    const result = getCustomPromptNotes(ws.workspaceId);
    expect(result).toBeNull();
  });

  it('returns null when custom_prompt_notes is whitespace only', () => {
    db.prepare('UPDATE workspaces SET custom_prompt_notes = ? WHERE id = ?').run('   ', ws.workspaceId);
    const result = getCustomPromptNotes(ws.workspaceId);
    expect(result).toBeNull();
  });

  it('returns null for unknown workspace ID', () => {
    const result = getCustomPromptNotes('nonexistent-workspace-xyz');
    expect(result).toBeNull();
  });

  it('returns the exact trimmed content without leading/trailing whitespace', () => {
    db.prepare('UPDATE workspaces SET custom_prompt_notes = ? WHERE id = ?').run('\n  Important notes\n', ws.workspaceId);
    const result = getCustomPromptNotes(ws.workspaceId);
    expect(result).toBe('Important notes');
    // reset
    db.prepare('UPDATE workspaces SET custom_prompt_notes = NULL WHERE id = ?').run(ws.workspaceId);
  });
});

describe('buildSystemPromptFromAuthority', () => {
  it('renders captured voice and notes once without reading workspace state', () => {
    const result = buildSystemPromptFromAuthority(
      'Base instructions',
      {
        systemVoiceBlock: 'Captured voice DNA and guardrails',
        customNotes: 'Captured operator notes',
      },
      { skipProseRules: true },
    );

    expect(result).toBe([
      'Base instructions',
      'Captured voice DNA and guardrails',
      'Additional context for this client:\nCaptured operator notes',
    ].join('\n\n'));
    expect(result.match(/Captured voice DNA and guardrails/g)).toHaveLength(1);
  });

  it('keeps the universal prose layer unless explicitly skipped', () => {
    const result = buildSystemPromptFromAuthority('Base', {
      systemVoiceBlock: '',
      customNotes: null,
    });

    expect(result).toBe(`Base\n\n${PROSE_QUALITY_RULES}`);
  });
});
