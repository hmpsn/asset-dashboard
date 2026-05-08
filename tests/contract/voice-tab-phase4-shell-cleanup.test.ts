import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const VOICE_TAB_PATH = 'src/components/brand/VoiceTab.tsx';
const VOICE_TAB_SHELL_PATH = 'src/components/brand/voice-tab/useVoiceTabShell.ts';

describe('VoiceTab phase-4 shell cleanup contract', () => {
  it('wires VoiceTab to the extracted shell hook and section registry', () => {
    const voiceTabSource = readFileSync(VOICE_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: VoiceTab root must consume extracted shell orchestration in phase 4.

    expect(voiceTabSource).toContain("from './voice-tab/useVoiceTabShell'");
    expect(voiceTabSource).toContain('useVoiceTabShell(workspaceId)');
    expect(voiceTabSource).toContain('tabs={VOICE_TAB_SECTIONS}');
  });

  it('keeps query/mutation/profile lifecycle ownership out of VoiceTab root', () => {
    const voiceTabSource = readFileSync(VOICE_TAB_PATH, 'utf-8'); // readFile-ok - migration guard: root should stay composition-only after phase-4 shell extraction.

    expect(voiceTabSource).not.toContain('useQuery(');
    expect(voiceTabSource).not.toContain('useMutation(');
    expect(voiceTabSource).not.toContain('useQueryClient(');
    expect(voiceTabSource).not.toContain('queryKeys.admin.voiceProfile');
    expect(voiceTabSource).not.toContain('voice.getProfile(');
    expect(voiceTabSource).not.toContain('voice.createProfile(');
    expect(voiceTabSource).not.toContain('const sections');
  });

  it('keeps shell orchestration in the extracted phase-4 module', () => {
    const shellSource = readFileSync(VOICE_TAB_SHELL_PATH, 'utf-8'); // readFile-ok - migration guard: shell module should own profile query/mutation orchestration and section definitions.

    expect(shellSource).toContain('export function useVoiceTabShell');
    expect(shellSource).toContain('export const VOICE_TAB_SECTIONS');
    expect(shellSource).toContain('queryKeys.admin.voiceProfile');
    expect(shellSource).toContain('voice.getProfile');
    expect(shellSource).toContain('voice.createProfile');
  });
});
