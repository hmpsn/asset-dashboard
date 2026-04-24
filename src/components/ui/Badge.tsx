interface BadgeProps {
  label: string;
  color?: 'teal' | 'blue' | 'emerald' | 'amber' | 'red' | 'orange' | 'zinc';
  className?: string;
}

const BADGE_COLORS: Record<string, string> = {
  teal: 'bg-teal-500/10 text-teal-400',
  blue: 'bg-blue-500/10 text-blue-400',
  emerald: 'bg-emerald-500/8 text-emerald-400/80',
  amber: 'bg-amber-500/8 text-amber-400/80',
  red: 'bg-red-500/8 text-red-400/80',
  orange: 'bg-orange-500/10 text-orange-400',
  zinc: 'bg-zinc-800 text-zinc-500',
};

export function Badge({ label, color = 'zinc', className }: BadgeProps) {
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${BADGE_COLORS[color] ?? BADGE_COLORS.zinc} ${className ?? ''}`}>
      {label}
    </span>
  );
}
