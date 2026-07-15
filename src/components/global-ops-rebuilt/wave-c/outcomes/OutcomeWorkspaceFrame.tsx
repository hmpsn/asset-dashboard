// @ds-rebuilt
import type { ReactNode } from 'react';

export function OutcomeWorkspaceFrame({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Workspace outcome tools"
      data-testid="outcome-dashboard-frame"
      className={[
        '[&>div]:!space-y-[14px]',
        '[&>div>div:first-child]:sr-only',
        '[&>div>div:nth-child(2)>div:first-child]:!px-[18px] [&>div>div:nth-child(2)>div:first-child]:!py-[13px]',
        '[&>div>div:nth-child(2)>div:last-child]:!p-[18px]',
        '[&>div>div:nth-child(2)>div:last-child>p]:!mb-4',
        '[&>div>div:nth-child(2)>div:last-child>form]:!grid [&>div>div:nth-child(2)>div:last-child>form]:!gap-3 md:[&>div>div:nth-child(2)>div:last-child>form]:!grid-cols-2',
        'md:[&>div>div:nth-child(2)>div:last-child>form>div:nth-child(3)]:!col-span-2',
        'md:[&>div>div:nth-child(2)>div:last-child>form>div:nth-child(4)]:!col-span-2',
        '[&>div>div:nth-child(3)]:!mt-1',
        '[&>div>div:nth-child(4)]:!mt-0',
      ].join(' ')}
    >
      {children}
    </section>
  );
}
