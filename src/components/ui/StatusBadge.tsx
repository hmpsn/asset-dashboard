import { statusConfig, type PageEditStatus } from './statusConfig';

interface StatusBadgeProps {
  status: PageEditStatus | undefined | null;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export function StatusBadge({ status, size = 'sm', showLabel = true }: StatusBadgeProps) {
  if (!status || status === 'clean') return null;
  const c = statusConfig[status];
  if (!c) return null;

  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const padding = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1';

  return (
    <span className={`${textSize} ${padding} rounded border ${c.border} ${c.bg} ${c.text} whitespace-nowrap`}>
      {showLabel ? c.label : <span className={`inline-block w-1.5 h-1.5 rounded-full ${c.dot}`} />}
    </span>
  );
}
