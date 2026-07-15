// @ds-rebuilt
import type { ReactNode } from 'react';
import { cn } from '../../../ui';
import type { BusinessTab } from '../../useGlobalOpsSurfaceState';

const REVENUE_FRAME = [
  '[&>div]:!mx-0 [&>div]:!max-w-none [&>div]:!px-0 [&>div]:!py-0 [&>div]:!space-y-[14px]',
  '[&>div>div:first-child:has(button)]:!min-h-7 [&>div>div:first-child:has(button)]:!justify-end',
  '[&>div>div:first-child:has(button)>div:first-child]:sr-only',
  '[&>div>div:nth-child(2)]:!gap-3',
  '[&>div>div:nth-child(4)]:!gap-[14px]',
].join(' ');

const USAGE_FRAME = [
  '[&>div]:!rounded-none [&>div]:!border-0 [&>div]:!bg-transparent',
  '[&>div>div:first-child]:!mb-[10px] [&>div>div:first-child]:!justify-end [&>div>div:first-child]:!border-0 [&>div>div:first-child]:!p-0',
  '[&>div>div:first-child>div:first-child]:sr-only',
  '[&>div>div:nth-child(2)]:!p-0',
  '[&>div>div:nth-child(2)>.mb-4]:!mb-[14px]',
  '[&>div>div:nth-child(2)>.mb-1]:!mb-0 [&>div>div:nth-child(2)>.mb-1]:rounded-[var(--radius-lg)] [&>div>div:nth-child(2)>.mb-1]:border [&>div>div:nth-child(2)>.mb-1]:border-[var(--brand-border)] [&>div>div:nth-child(2)>.mb-1]:bg-[var(--surface-2)] [&>div>div:nth-child(2)>.mb-1]:px-[18px] [&>div>div:nth-child(2)>.mb-1]:py-[15px]',
  '[&>div>div:nth-child(2)>.mt-4]:!mt-[14px] [&>div>div:nth-child(2)>.mt-4]:rounded-[var(--radius-lg)] [&>div>div:nth-child(2)>.mt-4]:!border [&>div>div:nth-child(2)>.mt-4]:border-[var(--brand-border)] [&>div>div:nth-child(2)>.mt-4]:bg-[var(--surface-2)] [&>div>div:nth-child(2)>.mt-4]:px-[18px] [&>div>div:nth-child(2)>.mt-4]:py-[15px]',
].join(' ');

const FEATURES_FRAME = [
  '[&>div]:!mx-0 [&>div]:!max-w-none [&>div]:!p-0 [&>div]:!space-y-4',
  '[&>div>div:first-child:not(:only-child)]:sr-only',
  '[&>div>div:nth-child(2)]:!mt-0 [&>div>div:nth-child(2)]:!gap-3',
  '[&>div>div:nth-child(2)>div:first-child]:!max-w-[360px]',
  '[&>div>div:nth-child(3)]:!space-y-[22px]',
].join(' ');

const PROSPECTS_FRAME = [
  '[&>div]:!p-0 [&>div]:!space-y-[18px]',
  '[&>div>.max-w-2xl]:!max-w-[600px]',
  '[&>div>.max-w-2xl:first-child>div:first-child]:!mb-[22px]',
  '[&>div>.max-w-2xl:first-child>div:first-child>div:first-child]:!mb-[14px] [&>div>.max-w-2xl:first-child>div:first-child>div:first-child]:!h-[52px] [&>div>.max-w-2xl:first-child>div:first-child>div:first-child]:!w-[52px]',
  '[&>div>.max-w-2xl:nth-child(2)]:!mt-[26px]',
].join(' ');

const FRAME_BY_TAB: Record<BusinessTab, string> = {
  revenue: REVENUE_FRAME,
  'ai-usage': USAGE_FRAME,
  features: FEATURES_FRAME,
  prospects: PROSPECTS_FRAME,
};

interface BusinessPanelFrameProps {
  tab: BusinessTab;
  children: ReactNode;
}

export function BusinessPanelFrame({ tab, children }: BusinessPanelFrameProps) {
  return (
    <section
      id={`business-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`business-tab-${tab}`}
      className={cn('min-w-0', FRAME_BY_TAB[tab])}
      data-testid="business-panel-frame"
      data-business-panel={tab}
    >
      {children}
    </section>
  );
}
