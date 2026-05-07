import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const VOICE_TAB_PATH = 'src/components/brand/VoiceTab.tsx';
const GUARDRAILS_SECTION_PATH = 'src/components/brand/voice-tab/GuardrailsSection.tsx';
const CALIBRATION_SECTION_PATH = 'src/components/brand/voice-tab/CalibrationSection.tsx';
const CALIBRATION_WORKFLOW_HOOK_PATH = 'src/components/brand/voice-tab/useVoiceCalibrationWorkflow.ts';

describe('VoiceTab phase-3 section extraction contract', () => {
  it('wires VoiceTab to extracted guardrails and calibration modules', () => {
    const voiceTabSource = readFileSync(VOICE_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: VoiceTab root must import phase-3 sections.

    expect(voiceTabSource).toContain("from './voice-tab/GuardrailsSection'");
    expect(voiceTabSource).toContain("from './voice-tab/CalibrationSection'");
  });

  it('keeps guardrails and calibration implementations out of VoiceTab root shell', () => {
    const voiceTabSource = readFileSync(VOICE_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: phase-3 implementations should not drift back into VoiceTab.

    expect(voiceTabSource).not.toContain('function GuardrailsSection');
    expect(voiceTabSource).not.toContain('function CalibrationSection');
    expect(voiceTabSource).not.toContain('useVoiceCalibrationWorkflow(');
  });

  it('keeps phase-3 exports and calibration workflow hook ownership in slice modules', () => {
    const guardrailsSource = readFileSync(GUARDRAILS_SECTION_PATH, 'utf-8'); // readFile-ok - migration guard: guardrails slice should own its section export.
    const calibrationSource = readFileSync(CALIBRATION_SECTION_PATH, 'utf-8'); // readFile-ok - migration guard: calibration slice should own section rendering.
    const workflowHookSource = readFileSync(CALIBRATION_WORKFLOW_HOOK_PATH, 'utf-8'); // readFile-ok - migration guard: calibration state/actions should live in workflow hook.

    expect(guardrailsSource).toContain('export function GuardrailsSection');
    expect(calibrationSource).toContain('export function CalibrationSection');
    expect(calibrationSource).toContain('useVoiceCalibrationWorkflow(');
    expect(workflowHookSource).toContain('export function useVoiceCalibrationWorkflow');
  });
});
