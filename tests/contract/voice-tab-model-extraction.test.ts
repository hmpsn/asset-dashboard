import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const VOICE_TAB_PATH = 'src/components/brand/VoiceTab.tsx';
const VOICE_TAB_MODEL_PATH = 'src/components/brand/voice-tab/voiceTabModel.ts';
const SAMPLES_SECTION_PATH = 'src/components/brand/voice-tab/SamplesSection.tsx';
const DNA_SECTION_PATH = 'src/components/brand/voice-tab/DNASection.tsx';
const GUARDRAILS_SECTION_PATH = 'src/components/brand/voice-tab/GuardrailsSection.tsx';
const CALIBRATION_SECTION_PATH = 'src/components/brand/voice-tab/CalibrationSection.tsx';
const CALIBRATION_WORKFLOW_HOOK_PATH = 'src/components/brand/voice-tab/useVoiceCalibrationWorkflow.ts';

describe('VoiceTab phase-1 model extraction contract', () => {
  it('keeps phase-1 model ownership in extracted voice-tab modules', () => {
    const voiceTabSource = readFileSync(VOICE_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: root shell should stay thin while extracted modules retain phase-1 model usage.
    const samplesSource = readFileSync(SAMPLES_SECTION_PATH, 'utf-8'); // readFile-ok - migration guard: samples slice should consume shared model constants.
    const dnaSource = readFileSync(DNA_SECTION_PATH, 'utf-8'); // readFile-ok - migration guard: dna slice should consume shared model helpers/defaults.
    const guardrailsSource = readFileSync(GUARDRAILS_SECTION_PATH, 'utf-8'); // readFile-ok - migration guard: guardrails slice should consume shared model helpers/defaults.
    const calibrationSource = readFileSync(CALIBRATION_SECTION_PATH, 'utf-8'); // readFile-ok - migration guard: calibration rendering should consume shared prompt options.
    const calibrationWorkflowHookSource = readFileSync(CALIBRATION_WORKFLOW_HOOK_PATH, 'utf-8'); // readFile-ok - migration guard: calibration workflow should own prompt-context mapping.

    expect(voiceTabSource).not.toContain("from './voice-tab/voiceTabModel'");
    expect(samplesSource).toContain("from './voiceTabModel'");
    expect(dnaSource).toContain("from './voiceTabModel'");
    expect(guardrailsSource).toContain("from './voiceTabModel'");
    expect(calibrationSource).toContain('PROMPT_TYPE_OPTIONS');
    expect(calibrationWorkflowHookSource).toContain('PROMPT_TYPE_TO_CONTEXT');
    expect(calibrationWorkflowHookSource).toContain('PROMPT_TYPE_OPTIONS');
    expect(guardrailsSource).toContain('appendUniqueRequiredTerminology');
    expect(dnaSource).toContain('appendUniqueListValue');
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
