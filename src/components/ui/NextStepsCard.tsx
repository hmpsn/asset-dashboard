import { CheckCircle2, Info, ChevronRight, X, type LucideIcon } from 'lucide-react';
import { SectionCard } from './SectionCard';
import { IconButton } from './IconButton';

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
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--brand-border)]">
        <VariantIcon className={`w-4 h-4 ${iconColor} flex-shrink-0`} />
        <span className="t-body font-semibold text-[var(--brand-text-bright)] flex-1">{title}</span>
        {onDismiss && (
          <IconButton icon={X} label="Dismiss" size="sm" onClick={onDismiss} />
        )}
      </div>

      {/* Step rows */}
      <div className="divide-y divide-[var(--brand-border)]">
        {steps.map((step) => {
          const StepIcon = step.icon;
          return (
            <button
              key={step.label}
              type="button"
              onClick={step.onClick}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-teal-500/5 transition-colors group"
            >
              {StepIcon && (
                <StepIcon className="w-4 h-4 text-[var(--brand-text-muted)] group-hover:text-[var(--teal)] flex-shrink-0 transition-colors" />
              )}
              <div className="flex-1 min-w-0">
                <span className="t-body text-[var(--brand-text)] group-hover:text-[var(--teal)] transition-colors block">
                  {step.label}
                </span>
                {step.description && (
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 truncate">{step.description}</p>
                )}
              </div>
              {step.estimatedTime && (
                <span className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded flex-shrink-0">
                  {step.estimatedTime}
                </span>
              )}
              <ChevronRight className="w-3.5 h-3.5 text-[var(--brand-text-muted)] group-hover:text-[var(--teal)] flex-shrink-0 transition-colors" />
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}
