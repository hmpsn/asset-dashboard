import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

export type InlineBannerTone = 'error' | 'warning' | 'info' | 'success';
export type InlineBannerSize = 'sm' | 'md';

interface InlineBannerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: InlineBannerTone;
  size?: InlineBannerSize;
  title?: React.ReactNode;
  message?: React.ReactNode;
  children?: React.ReactNode;
  icon?: LucideIcon | false;
  onDismiss?: () => void;
  dismissLabel?: string;
}

const TONE_STYLES: Record<InlineBannerTone, {
  container: string;
  icon: string;
  title: string;
  message: string;
  defaultIcon: LucideIcon;
}> = {
  error: {
    container: 'border-red-500/20 bg-red-500/8 text-accent-danger',
    icon: 'text-accent-danger',
    title: 'text-accent-danger',
    message: 'text-[var(--brand-text-muted)]',
    defaultIcon: AlertTriangle,
  },
  warning: {
    container: 'border-amber-500/25 bg-amber-500/8 text-accent-warning',
    icon: 'text-accent-warning',
    title: 'text-accent-warning',
    message: 'text-amber-100/80',
    defaultIcon: AlertTriangle,
  },
  info: {
    container: 'border-blue-500/20 bg-blue-500/8 text-accent-info',
    icon: 'text-accent-info',
    title: 'text-accent-info',
    message: 'text-[var(--brand-text-muted)]',
    defaultIcon: Info,
  },
  success: {
    container: 'border-emerald-500/20 bg-emerald-500/8 text-accent-success',
    icon: 'text-accent-success',
    title: 'text-accent-success',
    message: 'text-[var(--brand-text-muted)]',
    defaultIcon: CheckCircle,
  },
};

const SIZE_STYLES: Record<InlineBannerSize, { container: string; icon: 'sm' | 'md'; text: string }> = {
  sm: { container: 'gap-1.5 px-2 py-1.5 rounded-[var(--radius-md)]', icon: 'sm', text: 't-caption-sm' },
  md: { container: 'gap-2 px-4 py-3 rounded-[var(--radius-signature)]', icon: 'md', text: 't-caption-sm' },
};

export function InlineBanner({
  tone = 'error',
  size = 'md',
  title,
  message,
  children,
  icon,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
  role,
  ...rest
}: InlineBannerProps) {
  const toneStyle = TONE_STYLES[tone];
  const sizeStyle = SIZE_STYLES[size];
  const IconComponent = icon === false ? null : (icon ?? toneStyle.defaultIcon);
  const bannerRole = role ?? (tone === 'error' || tone === 'warning' ? 'alert' : 'status');
  const content = children ?? message;
  const hasTitle = title !== undefined && title !== null && title !== false;
  const hasContent = content !== undefined && content !== null && content !== false;

  return (
    <div
      role={bannerRole}
      className={cn(
        'flex items-start border',
        sizeStyle.container,
        toneStyle.container,
        className,
      )}
      {...rest}
    >
      {IconComponent && (
        <Icon
          as={IconComponent}
          size={sizeStyle.icon}
          className={cn('mt-0.5 flex-shrink-0', toneStyle.icon)}
        />
      )}
      <div className={cn('min-w-0 flex-1', hasTitle && hasContent && 'space-y-0.5')}>
        {hasTitle && <p className={cn('font-medium', sizeStyle.text, toneStyle.title)}>{title}</p>}
        {hasContent && (
          <div className={cn(sizeStyle.text, hasTitle ? toneStyle.message : 'text-current')}>
            {content}
          </div>
        )}
      </div>
      {onDismiss && (
        <IconButton
          icon={X}
          label={dismissLabel}
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          className="ml-1 flex-shrink-0"
        />
      )}
    </div>
  );
}
