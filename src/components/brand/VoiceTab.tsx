import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mic, Plus, Trash2, Sparkles, Loader2, Save } from 'lucide-react';
import { queryKeys } from '../../lib/queryKeys';
import { voice } from '../../api/brand-engine';
import type {
  VoiceGuardrails,
  CalibrationSession,
} from '../../../shared/types/brand-engine';
import { SectionCard, EmptyState, Skeleton, TabBar, Icon, Button, cn } from '../ui';
import { useToast } from '../Toast';
import { DNASection } from './voice-tab/DNASection';
import { SamplesSection } from './voice-tab/SamplesSection';
import {
  appendUniqueListValue,
  appendUniqueRequiredTerminology,
  defaultGuardrails,
  PROMPT_TYPE_OPTIONS,
  PROMPT_TYPE_TO_CONTEXT,
} from './voice-tab/voiceTabModel';

type VoiceSection = 'samples' | 'dna' | 'guardrails' | 'calibration';
// ─── Guardrails Section ───────────────────────────────────────────────────────

interface GuardrailsSectionProps {
  workspaceId: string;
  guardrails?: VoiceGuardrails;
  onChanged: () => void;
}

function addToList(list: string[], setList: (v: string[]) => void, val: string, clearFn: () => void) {
  const { next, added } = appendUniqueListValue(list, val);
  if (!added) return;
  setList(next);
  clearFn();
}

function GuardrailsSection({ workspaceId, guardrails, onChanged }: GuardrailsSectionProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [gr, setGr] = useState<VoiceGuardrails>(() => guardrails ?? defaultGuardrails);
  const [newForbidden, setNewForbidden] = useState('');
  const [newTermUse, setNewTermUse] = useState('');
  const [newTermInsteadOf, setNewTermInsteadOf] = useState('');
  const [newToneBoundary, setNewToneBoundary] = useState('');
  const [newAntiPattern, setNewAntiPattern] = useState('');

  useEffect(() => {
    if (guardrails) setGr(guardrails);
  }, [guardrails]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await voice.updateProfile(workspaceId, { guardrails: gr });
      toast('Guardrails saved');
      onChanged();
    } catch {
      toast('Failed to save guardrails', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Forbidden Words */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Forbidden Words</h3>
        <div className="flex flex-wrap gap-2">
          {gr.forbiddenWords.map(word => (
            <span
              key={word}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 text-red-400 rounded-[var(--radius-md)] t-caption"
            >
              {word}
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, forbiddenWords: prev.forbiddenWords.filter(w => w !== word) }))}
                aria-label={`Remove forbidden word: ${word}`}
                className="hover:text-red-300 transition-colors"
              >
                <Icon as={Trash2} size="sm" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="gr-forbidden-word" className="sr-only">New forbidden word</label>
          <input
            id="gr-forbidden-word"
            type="text"
            value={newForbidden}
            onChange={e => setNewForbidden(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addToList(gr.forbiddenWords, list => setGr(prev => ({ ...prev, forbiddenWords: list })), newForbidden, () => setNewForbidden(''));
              }
            }}
            placeholder="e.g. synergy, leverage"
            className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <Button
            type="button"
            onClick={() => addToList(gr.forbiddenWords, list => setGr(prev => ({ ...prev, forbiddenWords: list })), newForbidden, () => setNewForbidden(''))}
            disabled={!newForbidden.trim()}
            variant="primary"
            size="sm"
            icon={Plus}
          >
            Add
          </Button>
        </div>
      </div>

      {/* Required Terminology */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Required Terminology</h3>
        <div className="space-y-2">
          {gr.requiredTerminology.map((term, i) => (
            <div key={`${term.use}::${term.insteadOf}`} className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2">
              <span className="t-caption text-[var(--brand-text-muted)] shrink-0">Use</span>
              <span className="text-sm text-teal-400 font-medium">{term.use}</span>
              <span className="t-caption text-[var(--brand-text-muted)] shrink-0">instead of</span>
              <span className="text-sm text-[var(--brand-text-muted)] line-through">{term.insteadOf}</span>
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, requiredTerminology: prev.requiredTerminology.filter((_, idx) => idx !== i) }))}
                aria-label={`Remove terminology: use ${term.use} instead of ${term.insteadOf}`}
                className="ml-auto text-[var(--brand-text-muted)] hover:text-red-400 transition-colors"
              >
                <Icon as={Trash2} size="md" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="space-y-1 flex-1">
            <label htmlFor="gr-term-use" className="t-caption text-[var(--brand-text-muted)]">Use</label>
            <input
              id="gr-term-use"
              type="text"
              value={newTermUse}
              onChange={e => setNewTermUse(e.target.value)}
              placeholder="e.g. clients"
              className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>
          <div className="space-y-1 flex-1">
            <label htmlFor="gr-term-instead-of" className="t-caption text-[var(--brand-text-muted)]">Instead of</label>
            <input
              id="gr-term-instead-of"
              type="text"
              value={newTermInsteadOf}
              onChange={e => setNewTermInsteadOf(e.target.value)}
              placeholder="e.g. customers"
              className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              const result = appendUniqueRequiredTerminology(
                gr.requiredTerminology,
                newTermUse,
                newTermInsteadOf
              );
              if (!result.added) return;

              setGr(prev => ({ ...prev, requiredTerminology: result.next }));
              setNewTermUse('');
              setNewTermInsteadOf('');
            }}
            disabled={!newTermUse.trim() || !newTermInsteadOf.trim()}
            variant="primary"
            size="sm"
            icon={Plus}
            className="mt-5 shrink-0"
          >
            Add
          </Button>
        </div>
      </div>

      {/* Tone Boundaries */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Tone Boundaries</h3>
        <div className="flex flex-wrap gap-2">
          {gr.toneBoundaries.map(boundary => (
            <span
              key={boundary}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--surface-3)] text-[var(--brand-text)] rounded-[var(--radius-md)] t-caption"
            >
              {boundary}
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, toneBoundaries: prev.toneBoundaries.filter(b => b !== boundary) }))}
                aria-label={`Remove tone boundary: ${boundary}`}
                className="text-[var(--brand-text-muted)] hover:text-red-400 transition-colors"
              >
                <Icon as={Trash2} size="sm" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="gr-tone-boundary" className="sr-only">New tone boundary</label>
          <input
            id="gr-tone-boundary"
            type="text"
            value={newToneBoundary}
            onChange={e => setNewToneBoundary(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addToList(gr.toneBoundaries, list => setGr(prev => ({ ...prev, toneBoundaries: list })), newToneBoundary, () => setNewToneBoundary(''));
              }
            }}
            placeholder="e.g. Never condescending"
            className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <Button
            type="button"
            onClick={() => addToList(gr.toneBoundaries, list => setGr(prev => ({ ...prev, toneBoundaries: list })), newToneBoundary, () => setNewToneBoundary(''))}
            disabled={!newToneBoundary.trim()}
            variant="primary"
            size="sm"
            icon={Plus}
          >
            Add
          </Button>
        </div>
      </div>

      {/* Anti-patterns */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--brand-text)]">Anti-patterns</h3>
        <div className="flex flex-wrap gap-2">
          {gr.antiPatterns.map(pattern => (
            <span
              key={pattern}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-[var(--radius-md)] t-caption"
            >
              {pattern}
              <button
                type="button"
                onClick={() => setGr(prev => ({ ...prev, antiPatterns: prev.antiPatterns.filter(p => p !== pattern) }))}
                aria-label={`Remove anti-pattern: ${pattern}`}
                className="hover:text-amber-300 transition-colors"
              >
                <Icon as={Trash2} size="sm" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="gr-anti-pattern" className="sr-only">New anti-pattern</label>
          <input
            id="gr-anti-pattern"
            type="text"
            value={newAntiPattern}
            onChange={e => setNewAntiPattern(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addToList(gr.antiPatterns, list => setGr(prev => ({ ...prev, antiPatterns: list })), newAntiPattern, () => setNewAntiPattern(''));
              }
            }}
            placeholder="e.g. Starting every sentence with 'We'"
            className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          />
          <Button
            type="button"
            onClick={() => addToList(gr.antiPatterns, list => setGr(prev => ({ ...prev, antiPatterns: list })), newAntiPattern, () => setNewAntiPattern(''))}
            disabled={!newAntiPattern.trim()}
            variant="primary"
            size="sm"
            icon={Plus}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving}
          variant="primary"
          size="sm"
          icon={Save}
          loading={saving}
        >
          Save Guardrails
        </Button>
      </div>
    </div>
  );
}

// ─── Calibration Section ──────────────────────────────────────────────────────

interface CalibrationSectionProps {
  workspaceId: string;
  onSampleSaved: () => void;
}

function CalibrationSection({ workspaceId, onSampleSaved }: CalibrationSectionProps) {
  const { toast } = useToast();

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
    if (!session) return;
    // Find the best-rated variation index
    const bestIndex = (() => {
      // Prefer on_brand, then close, then 0
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

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-end gap-3">
        <div className="space-y-1 flex-1">
          <label htmlFor="calib-prompt-type" className="t-caption text-[var(--brand-text-muted)]">Prompt type</label>
          <select
            id="calib-prompt-type"
            value={promptType}
            onChange={e => setPromptType(e.target.value)}
            className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
          >
            {PROMPT_TYPE_OPTIONS.map(pt => (
              <option key={pt} value={pt}>{pt.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          variant="primary"
          size="sm"
          icon={Sparkles}
          loading={generating}
        >
          {generating ? 'Generating…' : 'Generate'}
        </Button>
      </div>

      {/* Loading state */}
      {generating && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {/* Variations */}
      {!generating && session && (
        <div className="space-y-4">
          {session.variations.map((variation, i) => {
            const rating = localRatings[i];
            return (
              // pr-check-disable-next-line -- variation card uses dynamic border color for rating feedback; SectionCard does not support dynamic border overrides
              <div
                key={i}
                className={cn(
                  'bg-[var(--surface-2)] border rounded-[var(--radius-xl)] p-4 space-y-3 transition-colors',
                  rating === 'on_brand'
                    ? 'border-teal-500/50'
                    : rating === 'close'
                    ? 'border-[var(--brand-border-hover)]'
                    : rating === 'wrong'
                    ? 'border-red-500/30'
                    : 'border-[var(--brand-border)]'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="t-caption text-[var(--brand-text-muted)] font-medium">Variation {i + 1}</span>
                  {rating && (
                    <span
                      className={cn(
                        't-caption font-medium px-2 py-0.5 rounded',
                        rating === 'on_brand'
                          ? 'bg-teal-500/10 text-teal-400'
                          : rating === 'close'
                          ? 'bg-[var(--surface-3)] text-[var(--brand-text)]'
                          : 'bg-red-500/10 text-red-400'
                      )}
                    >
                      {rating.replace('_', ' ')}
                    </span>
                  )}
                </div>

                <p className="text-sm text-[var(--brand-text)] leading-relaxed">{variation.text}</p>

                {/* Rating buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="t-caption text-[var(--brand-text-muted)]">Rate:</span>
                  {(
                    [
                      { value: 'on_brand' as const, label: 'On-brand', activeClass: 'bg-teal-600 text-white' },
                      { value: 'close' as const, label: 'Close', activeClass: 'bg-[var(--brand-border-hover)] text-white' },
                      { value: 'wrong' as const, label: 'Wrong', activeClass: 'bg-red-600 text-white' },
                    ] as const
                  ).map(({ value, label, activeClass }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLocalRatings(prev => ({ ...prev, [i]: value }))}
                      className={cn(
                        'px-2.5 py-1 rounded-[var(--radius-md)] t-caption font-medium transition-colors',
                        rating === value
                          ? activeClass
                          : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:bg-[var(--brand-border-hover)]'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Feedback input */}
                <div className="space-y-1">
                  <label htmlFor={`calib-feedback-${i}`} className="t-caption text-[var(--brand-text-muted)]">
                    Feedback (optional)
                  </label>
                  <input
                    id={`calib-feedback-${i}`}
                    type="text"
                    value={localFeedback[i] ?? ''}
                    onChange={e => setLocalFeedback(prev => ({ ...prev, [i]: e.target.value }))}
                    placeholder="e.g. Good tone but too long"
                    className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                  />
                </div>

                {/* Actions: Save feedback + Save as Sample */}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    onClick={() => handleSaveFeedback(i)}
                    disabled={savingFeedbackIndex === i || !localFeedback[i]?.trim()}
                    variant="secondary"
                    size="sm"
                    icon={savingFeedbackIndex === i ? Loader2 : Save}
                    loading={savingFeedbackIndex === i}
                  >
                    Save feedback
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleSaveAsSample(i, variation.text)}
                    disabled={savingIndex === i}
                    variant="secondary"
                    size="sm"
                    icon={savingIndex === i ? Loader2 : Save}
                    loading={savingIndex === i}
                  >
                    Save as Sample
                  </Button>
                </div>
              </div>
            );
          })}

          {/* Refine panel — show when at least one variation is rated */}
          {hasAnyRating && (
            <SectionCard title="Refine">
              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="calib-refine-direction" className="t-caption text-[var(--brand-text-muted)]">
                    Steering direction (optional)
                  </label>
                  <input
                    id="calib-refine-direction"
                    type="text"
                    value={refineDirection}
                    onChange={e => setRefineDirection(e.target.value)}
                    placeholder="e.g. Make it punchier and shorter"
                    className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleRefine}
                  disabled={refining}
                  variant="primary"
                  size="sm"
                  icon={refining ? Loader2 : Sparkles}
                  loading={refining}
                >
                  {refining ? 'Refining…' : 'Refine'}
                </Button>
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {/* Empty state — before first generate */}
      {!generating && !session && (
        <div className="text-center py-10 space-y-2">
          <Icon as={Sparkles} size="2xl" className="text-[var(--brand-text-muted)] mx-auto" />
          <p className="text-sm text-[var(--brand-text-muted)]">Select a prompt type and generate variations to start calibrating.</p>
        </div>
      )}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

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
      {/* Section tabs */}
      {/* tab-deeplink-ok: VoiceTab section tabs (samples/calibration/analytics) are not externally deep-linked */}
      <TabBar
        tabs={sections}
        active={activeSection}
        onChange={id => setActiveSection(id as VoiceSection)}
        className="mb-5"
      />

      {/* Section content */}
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
