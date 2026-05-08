import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/queryKeys';
import { voice } from '../../../api/brand-engine';
import { useToast } from '../../Toast';

export type VoiceSection = 'samples' | 'dna' | 'guardrails' | 'calibration';

export const VOICE_TAB_SECTIONS: { id: VoiceSection; label: string }[] = [
  { id: 'samples', label: 'Samples' },
  { id: 'dna', label: 'Voice DNA' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'calibration', label: 'Calibration' },
];

export function useVoiceTabShell(workspaceId: string) {
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

  return {
    profile,
    isLoading,
    activeSection,
    setActiveSection,
    createProfile: () => createProfileMutation.mutate(),
    isCreatingProfile: createProfileMutation.isPending,
    invalidateProfile,
  };
}
