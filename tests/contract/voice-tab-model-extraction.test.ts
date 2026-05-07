import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const VOICE_TAB_PATH = 'src/components/brand/VoiceTab.tsx';
const VOICE_TAB_MODEL_PATH = 'src/components/brand/voice-tab/voiceTabModel.ts';

describe('VoiceTab phase-1 model extraction contract', () => {
  it('wires VoiceTab to the extracted voice-tab model module', () => {
    const voiceTabSource = readFileSync(VOICE_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: VoiceTab should import phase-1 shared model/constants from the extracted module.

    expect(voiceTabSource).toContain("from './voice-tab/voiceTabModel'");
    expect(voiceTabSource).toContain('appendUniqueListValue');
    expect(voiceTabSource).toContain('appendUniqueRequiredTerminology');
  });

  it('keeps constants/defaults out of the VoiceTab monolith shell', () => {
    const voiceTabSource = readFileSync(VOICE_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: constants/defaults should remain in the extracted phase-1 module, not drift back into VoiceTab.

    expect(voiceTabSource).not.toContain('const CONTEXT_TAG_OPTIONS');
    expect(voiceTabSource).not.toContain('const PROMPT_TYPE_TO_CONTEXT');
    expect(voiceTabSource).not.toContain('const CONTEXT_TAG_COLORS');
    expect(voiceTabSource).not.toContain('const defaultDNA');
    expect(voiceTabSource).not.toContain('const defaultGuardrails');
  });

  it('keeps extracted model exports available for later phases', () => {
    const modelSource = readFileSync(VOICE_TAB_MODEL_PATH, 'utf-8'); // readFile-ok - migration guard: extracted model should retain shared exports for downstream VoiceTab phase extractions.

    expect(modelSource).toContain('export const CONTEXT_TAG_OPTIONS');
    expect(modelSource).toContain('export const PROMPT_TYPE_OPTIONS');
    expect(modelSource).toContain('export const PROMPT_TYPE_TO_CONTEXT');
    expect(modelSource).toContain('export const CONTEXT_TAG_COLORS');
    expect(modelSource).toContain('export const defaultDNA');
    expect(modelSource).toContain('export const defaultGuardrails');
  });
});
