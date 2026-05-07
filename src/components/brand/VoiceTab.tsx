import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mic, Loader2 } from 'lucide-react';
import { queryKeys } from '../../lib/queryKeys';
import { voice } from '../../api/brand-engine';
import { SectionCard, EmptyState, Skeleton, TabBar, Icon, Button } from '../ui';
import { useToast } from '../Toast';
import { DNASection } from './voice-tab/DNASection';
import { SamplesSection } from './voice-tab/SamplesSection';
import { GuardrailsSection } from './voice-tab/GuardrailsSection';
import { CalibrationSection } from './voice-tab/CalibrationSection';

type VoiceSection = 'samples' | 'dna' | 'guardrails' | 'calibration';

export function VoiceTab({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<VoiceSection>('samples');

  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.admin.voiceProfile(workspaceId),
    queryFn: () => voice.getProfile(workspaceId),
  });

  const createProfileMutation = useMutation({
    mutationFn: () => voice.createProfile(workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.voiceProfile(workspaceId) });
      toast('Voice profile created');
    },
    onError: () => {
      toast('Failed to create voice profile', 'error');
    },
  });

  const invalidateProfile = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.voiceProfile(workspaceId) });
  };

  const sections: { id: string; label: string }[] = [
    { id: 'samples', label: 'Samples' },
    { id: 'dna', label: 'Voice DNA' },
    { id: 'guardrails', label: 'Guardrails' },
    { id: 'calibration', label: 'Calibration' },
  ];

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
              onClick={() => createProfileMutation.mutate()}
              disabled={createProfileMutation.isPending}
              variant="primary"
              size="sm"
              icon={createProfileMutation.isPending ? Loader2 : undefined}
              loading={createProfileMutation.isPending}
            >
              {createProfileMutation.isPending ? 'Creating…' : 'Create voice profile'}
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
        tabs={sections}
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
