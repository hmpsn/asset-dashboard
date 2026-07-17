// @ds-rebuilt
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../../../lib/utils';

export interface WorkbenchFrameProps {
  /** Compact decision context and collection controls that stay visible. */
  pinned: ReactNode;
  /** The single collection owned by this workbench. */
  children: ReactNode;
  /** Labels the scrollable collection as an accessible region when provided. */
  collectionLabel?: string;
  className?: string;
  pinnedClassName?: string;
  collectionClassName?: string;
  id?: string;
}

/**
 * Viewport-bounded collection surface. Supporting content belongs in `pinned`
 * (usually behind Disclosure); `children` is always the one scroll owner.
 */
export function WorkbenchFrame({
  pinned,
  children,
  collectionLabel,
  className,
  pinnedClassName,
  collectionClassName,
  id,
}: WorkbenchFrameProps): ReactElement {
  return (
    <div
      id={id}
      className={cn('flex min-h-0 flex-col overflow-hidden', className)}
      style={{
        height: 'calc(100vh - var(--shell-topbar) - var(--page-pad-y) - var(--page-pad-bottom))',
      }}
      data-testid="workbench-frame"
    >
      <div className={cn('flex-none', pinnedClassName)} data-testid="workbench-pinned">
        {pinned}
      </div>
      <div
        className={cn('min-h-0 flex-1 overflow-auto', collectionClassName)}
        role={collectionLabel ? 'region' : undefined}
        aria-label={collectionLabel}
        data-workbench-collection
      >
        {children}
      </div>
    </div>
  );
}
