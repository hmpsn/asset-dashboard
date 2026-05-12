import { Mic, Loader2 } from 'lucide-react';
import { SectionCard, EmptyState, Skeleton, TabBar, Icon, Button } from '../ui';
import { DNASection } from './voice-tab/DNASection';
import { SamplesSection } from './voice-tab/SamplesSection';
import { GuardrailsSection } from './voice-tab/GuardrailsSection';
import { CalibrationSection } from './voice-tab/CalibrationSection';
import { VOICE_TAB_SECTIONS, useVoiceTabShell } from './voice-tab/useVoiceTabShell';
import type { VoiceSection } from './voice-tab/useVoiceTabShell';

export function VoiceTab({ workspaceId }: { workspaceId: string }) {
  const {
    profile,
    isLoading,
    activeSection,
    setActiveSection,
    createProfile,
    isCreatingProfile,
    invalidateProfile,
  } = useVoiceTabShell(workspaceId);

  if (isLoading) {
    return (
      <SectionCard
        title="Voice Calibration"
        titleIcon={<Icon as={Mic} size="md" className="text-teal-400" />}
      >
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </SectionCard>
    );
  }

  if (!profile) {
    return (
      <SectionCard
        title="Voice Calibration"
        titleIcon={<Icon as={Mic} size="md" className="text-teal-400" />}
      >
        <EmptyState
          icon={Mic}
          title="No voice profile yet"
          description="Create a voice profile to start calibrating your brand's tone and style."
          action={
            <Button
              type="button"
              onClick={createProfile}
              disabled={isCreatingProfile}
              variant="primary"
              size="sm"
              icon={isCreatingProfile ? Loader2 : undefined}
              loading={isCreatingProfile}
            >
              {isCreatingProfile ? 'Creating…' : 'Create voice profile'}
            </Button>
          }
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Voice Calibration"
      titleIcon={<Icon as={Mic} size="md" className="text-teal-400" />}
    >
      {/* tab-deeplink-ok: VoiceTab section tabs are local panel state, not route deep-link tabs */}
      <TabBar
        tabs={VOICE_TAB_SECTIONS}
        active={activeSection}
        onChange={id => setActiveSection(id as VoiceSection)}
        className="mb-5"
      />

      {activeSection === 'samples' && (
        <SamplesSection
          workspaceId={workspaceId}
          samples={profile.samples ?? []}
          onChanged={invalidateProfile}
        />
      )}

      {activeSection === 'dna' && (
        <DNASection
          workspaceId={workspaceId}
          voiceDNA={profile.voiceDNA}
          onChanged={invalidateProfile}
        />
      )}

      {activeSection === 'guardrails' && (
        <GuardrailsSection
          workspaceId={workspaceId}
          guardrails={profile.guardrails}
          onChanged={invalidateProfile}
        />
      )}

      {activeSection === 'calibration' && (
        <CalibrationSection
          workspaceId={workspaceId}
          onSampleSaved={invalidateProfile}
        />
      )}
    </SectionCard>
  );
}
