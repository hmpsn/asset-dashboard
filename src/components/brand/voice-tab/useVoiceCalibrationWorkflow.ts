import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { voice } from '../../../api/brand-engine';
import type { CalibrationSession } from '../../../../shared/types/brand-engine';
import { PROMPT_TYPE_OPTIONS, PROMPT_TYPE_TO_CONTEXT } from './voiceTabModel';

export function useVoiceCalibrationWorkflow(
  workspaceId: string,
  onSampleSaved: () => void,
  toast: (message: string, type?: 'success' | 'error' | 'info') => void
) {
  const [promptType, setPromptType] = useState(PROMPT_TYPE_OPTIONS[0]);
  const [generating, setGenerating] = useState(false);
  const [session, setSession] = useState<CalibrationSession | null>(null);
  const [localRatings, setLocalRatings] = useState<Record<number, 'on_brand' | 'close' | 'wrong'>>({});
  const [localFeedback, setLocalFeedback] = useState<Record<number, string>>({});
  const [refineDirection, setRefineDirection] = useState('');
  const [refining, setRefining] = useState(false);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [savingFeedbackIndex, setSavingFeedbackIndex] = useState<number | null>(null);

  const saveFeedbackMutation = useMutation({
    mutationFn: ({ sessionId, variationIndex, feedback }: { sessionId: string; variationIndex: number; feedback: string }) =>
      voice.saveVariationFeedback(workspaceId, sessionId, variationIndex, feedback),
    onSuccess: (_data, variables) => {
      setSavingFeedbackIndex(null);
      toast(`Feedback saved for variation ${variables.variationIndex + 1}`);
    },
    onError: () => {
      setSavingFeedbackIndex(null);
      toast('Failed to save feedback', 'error');
    },
  });

  const handleSaveFeedback = (variationIndex: number) => {
    if (!session) return;
    const feedback = localFeedback[variationIndex];
    if (!feedback?.trim()) {
      toast('No feedback to save', 'error');
      return;
    }
    setSavingFeedbackIndex(variationIndex);
    saveFeedbackMutation.mutate({ sessionId: session.id, variationIndex, feedback: feedback.trim() });
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setSession(null);
    setLocalRatings({});
    setLocalFeedback({});
    setRefineDirection('');
    try {
      const result = await voice.calibrate(workspaceId, { promptType });
      setSession(result);
      toast('Generated 3 variations');
    } catch {
      toast('Failed to generate variations', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleRefine = async () => {
    if (!session || session.variations.length === 0) return;

    const bestIndex = (() => {
      for (let i = 0; i < session.variations.length; i++) {
        if (localRatings[i] === 'on_brand') return i;
      }
      for (let i = 0; i < session.variations.length; i++) {
        if (localRatings[i] === 'close') return i;
      }
      return 0;
    })();

    setRefining(true);
    try {
      const updated = await voice.refine(workspaceId, session.id, {
        variationIndex: bestIndex,
        direction: refineDirection.trim() || 'same direction',
      });
      setSession(updated);
      setLocalRatings({});
      setLocalFeedback({});
      setRefineDirection('');
      toast('Refined variations generated');
    } catch {
      toast('Failed to refine variations', 'error');
    } finally {
      setRefining(false);
    }
  };

  const handleSaveAsSample = async (variationIndex: number, text: string) => {
    const contextTag = PROMPT_TYPE_TO_CONTEXT[promptType];
    setSavingIndex(variationIndex);
    try {
      await voice.addSample(workspaceId, {
        content: text,
        contextTag: contextTag,
        source: 'calibration_loop',
      });
      toast('Saved as sample');
      onSampleSaved();
    } catch {
      toast('Failed to save sample', 'error');
    } finally {
      setSavingIndex(null);
    }
  };

  const hasAnyRating = Object.keys(localRatings).length > 0;

  return {
    promptType,
    setPromptType,
    generating,
    session,
    localRatings,
    setLocalRatings,
    localFeedback,
    setLocalFeedback,
    refineDirection,
    setRefineDirection,
    refining,
    savingIndex,
    savingFeedbackIndex,
    hasAnyRating,
    handleGenerate,
    handleRefine,
    handleSaveFeedback,
    handleSaveAsSample,
  };
}
