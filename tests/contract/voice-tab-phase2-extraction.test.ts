import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const VOICE_TAB_PATH = 'src/components/brand/VoiceTab.tsx';
const SAMPLES_SECTION_PATH = 'src/components/brand/voice-tab/SamplesSection.tsx';
const DNA_SECTION_PATH = 'src/components/brand/voice-tab/DNASection.tsx';

describe('VoiceTab phase-2 section extraction contract', () => {
  it('wires VoiceTab to extracted samples and dna section modules', () => {
    const voiceTabSource = readFileSync(VOICE_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: VoiceTab root must import extracted section modules.

    expect(voiceTabSource).toContain("from './voice-tab/SamplesSection'");
    expect(voiceTabSource).toContain("from './voice-tab/DNASection'");
  });

  it('keeps samples and dna implementations out of the VoiceTab root shell', () => {
    const voiceTabSource = readFileSync(VOICE_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: section implementations should remain extracted, not inlined into VoiceTab.

    expect(voiceTabSource).not.toContain('function SamplesSection');
    expect(voiceTabSource).not.toContain('function DNASection');
    expect(voiceTabSource).not.toContain('function ContextTagBadge');
  });

  it('keeps extracted section exports and local helper ownership in slice modules', () => {
    const samplesSource = readFileSync(SAMPLES_SECTION_PATH, 'utf-8'); // readFile-ok - migration guard: samples slice should own its section export and local context-tag helper.
    const dnaSource = readFileSync(DNA_SECTION_PATH, 'utf-8'); // readFile-ok - migration guard: dna slice should own its section export.

    expect(samplesSource).toContain('export function SamplesSection');
    expect(samplesSource).toContain('function ContextTagBadge');
    expect(dnaSource).toContain('export function DNASection');
  });
});
