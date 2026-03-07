interface BadgeProps {
  label: string;
  color?: 'teal' | 'blue' | 'emerald' | 'green' | 'amber' | 'red' | 'orange' | 'purple' | 'zinc';
  className?: string;
}

const BADGE_COLORS: Record<string, string> = {
  teal: 'bg-teal-500/10 text-teal-400',
  blue: 'bg-blue-500/10 text-blue-400',
  emerald: 'bg-emerald-500/10 text-emerald-400',
  green: 'bg-green-500/10 text-green-400',
  amber: 'bg-amber-500/10 text-amber-400',
  red: 'bg-red-500/10 text-red-400',
  orange: 'bg-orange-500/10 text-orange-400',
  purple: 'bg-purple-500/10 text-purple-400',
  zinc: 'bg-zinc-800 text-zinc-500',
};

export function Badge({ label, color = 'zinc', className }: BadgeProps) {
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${BADGE_COLORS[color] ?? BADGE_COLORS.zinc} ${className ?? ''}`}>
      {label}
    </span>
  );
}
