import { CheckCircle2, Info, ChevronRight, X, type LucideIcon } from 'lucide-react';
import { SectionCard } from './SectionCard';

interface NextStep {
  label: string;
  description?: string;
  icon?: LucideIcon;
  onClick: () => void;
  estimatedTime?: string;
}

interface NextStepsCardProps {
  title: string;
  icon?: LucideIcon;
  steps: NextStep[];
  onDismiss?: () => void;
  variant?: 'success' | 'info';
  staggerIndex?: number;
}

export function NextStepsCard({
  title,
  icon,
  steps,
  onDismiss,
  variant = 'success',
  staggerIndex,
}: NextStepsCardProps) {
  const VariantIcon = icon ?? (variant === 'success' ? CheckCircle2 : Info);
  const iconColor = variant === 'success' ? 'text-emerald-400' : 'text-blue-400';

  if (steps.length === 0) return null;

  return (
    <SectionCard staggerIndex={staggerIndex} noPadding>
      {/* Title row */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800">
        <VariantIcon className={`w-4 h-4 ${iconColor} flex-shrink-0`} />
        <span className="text-sm font-semibold text-zinc-200 flex-1">{title}</span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Step rows */}
      <div className="divide-y divide-zinc-800/50">
        {steps.map((step) => {
          const StepIcon = step.icon;
          return (
            <button
              key={step.label}
              onClick={step.onClick}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-teal-500/5 transition-colors group"
            >
              {StepIcon && (
                <StepIcon className="w-4 h-4 text-zinc-500 group-hover:text-teal-400 flex-shrink-0 transition-colors" />
              )}
              <div className="flex-1 min-w-0">
                <span className="text-sm text-zinc-300 group-hover:text-teal-300 transition-colors block">
                  {step.label}
                </span>
                {step.description && (
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">{step.description}</p>
                )}
              </div>
              {step.estimatedTime && (
                <span className="text-[11px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded flex-shrink-0">
                  {step.estimatedTime}
                </span>
              )}
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-teal-400 flex-shrink-0 transition-colors" />
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}
