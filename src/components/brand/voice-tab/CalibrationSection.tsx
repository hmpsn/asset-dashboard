import { Loader2, Save, Sparkles } from 'lucide-react';
import { SectionCard, Skeleton, Button, Icon, cn } from '../../ui';
import { useToast } from '../../Toast';
import { PROMPT_TYPE_OPTIONS } from './voiceTabModel';
import { useVoiceCalibrationWorkflow } from './useVoiceCalibrationWorkflow';

interface CalibrationSectionProps {
  workspaceId: string;
  onSampleSaved: () => void;
}

export function CalibrationSection({ workspaceId, onSampleSaved }: CalibrationSectionProps) {
  const { toast } = useToast();
  const {
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
  } = useVoiceCalibrationWorkflow(workspaceId, onSampleSaved, toast);

  return (
    <div className="space-y-5">
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

      {generating && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

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

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="t-caption text-[var(--brand-text-muted)]">Rate:</span>
                  {(
                    [
                      { value: 'on_brand' as const, label: 'On-brand', activeClass: 'bg-teal-600 text-white' },
                      { value: 'close' as const, label: 'Close', activeClass: 'bg-[var(--brand-border-hover)] text-white' },
                      { value: 'wrong' as const, label: 'Wrong', activeClass: 'bg-red-600 text-white' },
                    ] as const
                  ).map(({ value, label, activeClass }) => (
                    <Button
                      key={value}
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-pressed={rating === value}
                      onClick={() => setLocalRatings(prev => ({ ...prev, [i]: value }))}
                      className={cn(
                        'px-2.5 py-1 rounded-[var(--radius-md)] t-caption font-medium transition-colors',
                        rating === value
                          ? activeClass
                          : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:bg-[var(--brand-border-hover)]'
                      )}
                    >
                      {label}
                    </Button>
                  ))}
                </div>

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

      {!generating && !session && (
        <div className="text-center py-10 space-y-2">
          <Icon as={Sparkles} size="2xl" className="text-[var(--brand-text-muted)] mx-auto" />
          <p className="text-sm text-[var(--brand-text-muted)]">Select a prompt type and generate variations to start calibrating.</p>
        </div>
      )}
    </div>
  );
}
