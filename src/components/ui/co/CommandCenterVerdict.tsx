// @ds-rebuilt
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import { Icon } from '../Icon';
import type { IconName } from '../iconNames';

export interface CommandCenterVerdictProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  iconName?: IconName;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

/**
 * co .co-head -> DS verdict header. Uses PageHeader-like hierarchy but keeps the
 * mockup's compact command-center emphasis as a reusable layout block.
 */
export function CommandCenterVerdict({
  eyebrow,
  title,
  description,
  meta,
  iconName = 'bell',
  className,
  id,
  style,
}: CommandCenterVerdictProps): ReactElement {
  return (
    <section
      id={id}
      className={cn(
        // pr-check-disable-next-line -- brand signature radius on the verdict container (owner-ratified global asymmetric-on-containers, ui-parity)
        'relative overflow-hidden rounded-[var(--radius-signature-lg)] border border-[var(--brand-border)]',
        'bg-[var(--surface-2)] px-5 py-4',
        className,
      )}
      style={style}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-full w-28"
        style={{ background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--teal) 10%, transparent))' }}
      />
      <div className="relative flex items-start gap-3">
        <span
          className="mt-0.5 inline-flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)]"
          style={{ background: 'var(--brand-mint-dim)', color: 'var(--teal)' }}
        >
          <Icon name={iconName} size="md" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {eyebrow && <p className="t-label m-0 text-[var(--teal)]">{eyebrow}</p>}
            {meta && <div className="ml-auto t-caption-sm text-[var(--brand-text-muted)]">{meta}</div>}
          </div>
          <h2 className="t-page m-0 mt-1 max-w-[48rem] font-semibold text-[var(--brand-text-bright)]">
            {title}
          </h2>
          {description && (
            <p className="t-body m-0 mt-2 max-w-[60rem] text-[var(--brand-text)]">
              {description}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
