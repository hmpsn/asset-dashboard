/**
 * OnboardingChecklist — Modal overlay guiding users through initial workspace setup.
 * Shown on first workspace visit. Pure UI component, no backend dependency.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { CheckCircle, Circle, Clock, X } from 'lucide-react';

export interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  onClick: () => void;
  estimatedTime?: string;
}

export interface OnboardingChecklistProps {
  steps: OnboardingStep[];
  onDismiss: () => void;
  onComplete?: () => void;
  title?: string;
}

export function OnboardingChecklist({
  steps,
  onDismiss,
  onComplete,
  title = 'Get started with your workspace',
}: OnboardingChecklistProps) {
  const completedCount = steps.filter(s => s.completed).length;
  const totalCount = steps.length;
  const allComplete = totalCount > 0 && completedCount === totalCount;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus to panel on mount
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Escape key dismisses the modal
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
      onDismissRef.current();
    };
    document.addEventListener('keydown', handleKeyDown); // keydown-ok — isContentEditable guard on line above
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Tab key trap — keep focus within the panel
  const handlePanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const focusableArr = Array.from(focusable);
    if (focusableArr.length === 0) return;
    const first = focusableArr[0];
    const last = focusableArr[focusableArr.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // Auto-dismiss after 2s when all steps are complete
  useEffect(() => {
    if (!allComplete) return;
    onCompleteRef.current?.();
    const timer = setTimeout(() => {
      onDismissRef.current();
    }, 2000);
    return () => clearTimeout(timer);
  }, [allComplete]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-checklist-title"
    >
      {/* Backdrop click dismisses */}
      <div className="absolute inset-0" onClick={onDismiss} aria-hidden="true" />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className="relative w-full max-w-lg bg-zinc-900 border border-zinc-800 shadow-2xl outline-none"
        style={{ borderRadius: '10px 24px 10px 24px' }}
      >
        {allComplete ? (
          /* Completion celebration */
          <div className="flex flex-col items-center justify-center py-16 px-6 gap-4">
            <div className="w-16 h-16 rounded-full bg-teal-500/10 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-teal-400" />
            </div>
            <h2 id="onboarding-checklist-title" className="text-lg font-semibold text-zinc-200">You're all set!</h2>
            <p className="text-sm text-zinc-400 text-center">
              All setup steps are complete. Your workspace is ready to go.
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 id="onboarding-checklist-title" className="text-base font-semibold text-zinc-200">{title}</h2>
              <button
                onClick={onDismiss}
                className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                aria-label="Close onboarding checklist"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Progress bar — blue for data (read-only metric) */}
            <div className="px-5 pb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-zinc-400">
                  {completedCount} of {totalCount} steps completed
                </span>
                <span className="text-xs font-medium text-blue-400">
                  {Math.round(progressPct)}%
                </span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Steps list */}
            <div className="px-5 pb-3 space-y-1">
              {steps.map(step => (
                <button
                  key={step.id}
                  onClick={step.onClick}
                  className="w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left hover:bg-zinc-800/60 transition-colors group"
                  aria-label={`${step.completed ? 'Completed: ' : ''}${step.label}`}
                >
                  {/* Check indicator — teal for completed (action/active state) */}
                  <div className="mt-0.5 flex-shrink-0">
                    {step.completed ? (
                      <CheckCircle className="w-5 h-5 text-teal-400" />
                    ) : (
                      <Circle className="w-5 h-5 text-zinc-600 group-hover:text-zinc-500 transition-colors" />
                    )}
                  </div>

                  {/* Label + description */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-medium ${
                          step.completed
                            ? 'text-zinc-500 line-through'
                            : 'text-zinc-200 group-hover:text-zinc-100'
                        } transition-colors`}
                      >
                        {step.label}
                      </span>
                      {step.estimatedTime && !step.completed && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-zinc-500 bg-zinc-800">
                          <Clock className="w-3 h-3" />
                          {step.estimatedTime}
                        </span>
                      )}
                    </div>
                    <p
                      className={`text-xs mt-0.5 ${
                        step.completed ? 'text-zinc-600' : 'text-zinc-400'
                      }`}
                    >
                      {step.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 pt-2 border-t border-zinc-800">
              <button
                onClick={onDismiss}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Dismiss for now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
