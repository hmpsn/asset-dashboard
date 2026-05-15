import { cn } from '../../lib/utils';

interface CharacterCounterProps {
  current: number;
  max: number;
  showPercentage?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function CharacterCounter({ 
  current, 
  max, 
  showPercentage = false, 
  size = 'sm',
  className 
}: CharacterCounterProps) {
  const percentage = (current / max) * 100;
  
  // Determine color based on percentage
  let colorClass = 'text-emerald-400/80';
  if (percentage >= 95) {
    colorClass = 'text-red-400/80';
  } else if (percentage >= 80) {
    colorClass = 'text-amber-400/80';
  }
  
  const sizeClasses = {
    sm: 't-micro',
    md: 'text-xs',
    lg: 'text-sm'
  };
  
  return (
    <div className={cn(
      'flex items-center gap-1 font-mono',
      sizeClasses[size],
      colorClass,
      className
    )}>
      <span>{current}</span>
      <span className="text-[var(--brand-text-dim)]">/</span>
      <span>{max}</span>
      {showPercentage && (
        <span className="text-[var(--brand-text-dim)]">({Math.round(percentage)}%)</span>
      )}
    </div>
  );
}
