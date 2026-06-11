import { Clock3 } from 'lucide-react';
import { Icon } from './Icon';
import { cn } from '../../lib/utils';

export interface FreshnessStampProps {
  value?: string | number | null;
  label?: string;
  className?: string;
}

function parseFreshnessValue(value: string | number | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && value <= 0) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function FreshnessStamp({
  value,
  label = 'Data as of',
  className,
}: FreshnessStampProps) {
  const date = parseFreshnessValue(value);
  if (!date) return null;

  const formatted = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

  return (
    <p className={cn('inline-flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)]', className)}>
      <Icon as={Clock3} size="sm" className="text-[var(--brand-text-muted)]" />
      <span>{label} <time dateTime={date.toISOString()}>{formatted}</time></span>
    </p>
  );
}
