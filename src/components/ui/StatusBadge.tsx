import { Badge, type BadgeShape, type BadgeSize, type BadgeVariant } from './Badge';
import {
  resolveStatusBadgeConfig,
  type PageEditStatus,
  type StatusBadgeDomain,
} from './statusConfig';

interface StatusBadgeProps {
  status: PageEditStatus | string | undefined | null;
  domain?: StatusBadgeDomain;
  size?: BadgeSize;
  shape?: BadgeShape;
  variant?: BadgeVariant;
  showLabel?: boolean;
  fallback?: 'neutral';
  className?: string;
}

export function StatusBadge({
  status,
  domain = 'page-edit',
  size = 'sm',
  shape = 'sm',
  variant = 'outline',
  showLabel = true,
  fallback,
  className,
}: StatusBadgeProps) {
  if (!status || status === 'clean') return null;
  const c = resolveStatusBadgeConfig(domain, status, fallback);
  if (!c) return null;

  return (
    <Badge
      label={showLabel ? c.label : ''}
      tone={c.tone}
      variant={variant}
      size={size}
      shape={shape}
      dot={!showLabel}
      ariaLabel={!showLabel ? c.label : undefined}
      className={className}
    />
  );
}
