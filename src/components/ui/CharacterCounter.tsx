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
  let colorClass = 'text-green-400';
  if (percentage >= 95) {
    colorClass = 'text-red-400';
  } else if (percentage >= 80) {
    colorClass = 'text-amber-400';
  }
  
  const sizeClasses = {
    sm: 'text-[10px]',
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
      <span className="text-zinc-500">/</span>
      <span>{max}</span>
      {showPercentage && (
        <span className="text-zinc-500">({Math.round(percentage)}%)</span>
      )}
    </div>
  );
}
