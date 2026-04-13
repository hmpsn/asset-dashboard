import { CheckCircle } from 'lucide-react';

export interface WorkflowStep {
  number: number;
  label: string;
  completed: boolean;
  current?: boolean;
  onClick?: () => void;
}

export interface WorkflowStepperProps {
  steps: WorkflowStep[];
  compact?: boolean;
}

export function WorkflowStepper({ steps, compact = false }: WorkflowStepperProps) {
  const circleSize = compact ? 'w-6 h-6' : 'w-8 h-8';
  const labelSize = compact ? 'text-[10px]' : 'text-xs';
  const gap = compact ? 'gap-1' : 'gap-2';
  const numberSize = compact ? 'text-[10px]' : 'text-xs';
  const iconSize = compact ? 'w-3 h-3' : 'w-4 h-4';

  return (
    <nav aria-label="Workflow steps" className="w-full">
      <ol className="flex items-start w-full">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const isClickable = !!step.onClick;

          let circleClasses: string;
          let labelClasses: string;
          let ringClasses = '';

          if (step.completed) {
            circleClasses = `bg-green-500/10 border-2 border-green-500/40 text-green-400`;
            labelClasses = `text-green-400 font-medium`;
          } else if (step.current) {
            circleClasses = `bg-teal-500/10 border-2 border-teal-500 text-teal-400`;
            labelClasses = `text-teal-400 font-semibold`;
            ringClasses = 'ring-2 ring-teal-500/30 ring-offset-1 ring-offset-zinc-900';
          } else {
            circleClasses = `bg-zinc-800/50 border-2 border-zinc-700 text-zinc-500`;
            labelClasses = `text-zinc-500`;
          }

          if (isClickable && step.completed) {
            circleClasses += ' group-hover:border-teal-500 group-hover:text-teal-400 group-hover:bg-teal-500/10 transition-colors';
            labelClasses += ' group-hover:text-teal-400 transition-colors';
          }

          const stepContent = (
            <div className={`flex flex-col items-center ${gap}`}>
              <div className="relative">
                <div
                  className={`${circleSize} rounded-full flex items-center justify-center flex-shrink-0 ${circleClasses} ${ringClasses}`}
                >
                  {step.completed ? (
                    <CheckCircle className={iconSize} />
                  ) : (
                    <span className={`font-bold leading-none ${numberSize}`}>{step.number}</span>
                  )}
                </div>
              </div>
              <span
                className={`${labelSize} ${labelClasses} text-center leading-tight max-w-[4rem] whitespace-nowrap`}
                aria-current={step.current ? 'step' : undefined}
              >
                {step.label}
              </span>
            </div>
          );

          return (
            <li key={step.number} className="flex flex-1 items-start min-w-0">
              {isClickable ? (
                <button
                  type="button"
                  onClick={step.onClick}
                  className={`group flex flex-col items-center ${gap} cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 rounded-md`}
                  aria-label={`Step ${step.number}: ${step.label}${step.completed ? ' (completed)' : step.current ? ' (current)' : ''}`}
                >
                  <div className="relative">
                    <div
                      className={`${circleSize} rounded-full flex items-center justify-center flex-shrink-0 ${circleClasses} ${ringClasses}`}
                    >
                      {step.completed ? (
                        <CheckCircle className={iconSize} />
                      ) : (
                        <span className={`font-bold leading-none ${numberSize}`}>{step.number}</span>
                      )}
                    </div>
                  </div>
                  <span
                    className={`${labelSize} ${labelClasses} text-center leading-tight max-w-[4rem] whitespace-nowrap`}
                    aria-current={step.current ? 'step' : undefined}
                  >
                    {step.label}
                  </span>
                </button>
              ) : (
                <div
                  className="flex flex-col items-center gap-1"
                  aria-label={`Step ${step.number}: ${step.label}${step.completed ? ' (completed)' : step.current ? ' (current)' : ''}`}
                >
                  {stepContent}
                </div>
              )}

              {!isLast && (
                <div className="flex-1 flex items-start pt-3 mx-1 min-w-[8px]">
                  <div className={`w-full h-px ${compact ? 'mt-0' : 'mt-1'} bg-zinc-700`} aria-hidden="true" />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
