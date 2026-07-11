// @ds-rebuilt
import { useEffect, useRef } from 'react';
import { Button, Icon, useRovingTabindex } from '../../../ui';
import type { BusinessTab } from '../../useGlobalOpsSurfaceState';

const BUSINESS_TAB_OPTIONS = [
  { value: 'revenue', label: 'Revenue', icon: 'trophy' },
  { value: 'ai-usage', label: 'Usage', icon: 'gauge' },
  { value: 'features', label: 'Features', icon: 'layers' },
  { value: 'prospects', label: 'Prospects', icon: 'user' },
] as const satisfies ReadonlyArray<{ value: BusinessTab; label: string; icon: string }>;

interface BusinessTabTrayProps {
  value: BusinessTab;
  onChange: (value: BusinessTab) => void;
}

export function BusinessTabTray({ value, onChange }: BusinessTabTrayProps) {
  const trayRef = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, BUSINESS_TAB_OPTIONS.findIndex((option) => option.value === value));
  const { activeIndex, setActiveIndex, getItemProps } = useRovingTabindex(BUSINESS_TAB_OPTIONS.length, {
    orientation: 'horizontal',
    wrap: true,
    defaultIndex: selectedIndex,
    onActivate: (index) => {
      const option = BUSINESS_TAB_OPTIONS[index];
      if (option) onChange(option.value);
    },
  });

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex, setActiveIndex]);

  useEffect(() => {
    const tray = trayRef.current;
    const selectedTab = tray?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!tray || !selectedTab) return;

    const inset = 4;
    const selectedLeft = selectedTab.offsetLeft;
    const selectedRight = selectedLeft + selectedTab.offsetWidth;
    const visibleLeft = tray.scrollLeft + inset;
    const visibleRight = tray.scrollLeft + tray.clientWidth - inset;
    if (selectedRight > visibleRight) {
      tray.scrollLeft = selectedRight - tray.clientWidth + inset;
    } else if (selectedLeft < visibleLeft) {
      tray.scrollLeft = selectedLeft - inset;
    }
  }, [value]);

  return (
    <div
      role="tablist"
      aria-label="Business sections"
      ref={trayRef}
      className="mb-[18px] inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[11px] border border-[var(--brand-border)] bg-[var(--surface-2)] p-1"
      data-testid="business-tab-tray"
    >
      {BUSINESS_TAB_OPTIONS.map((option, index) => {
        const selected = option.value === value;
        const itemProps = getItemProps(index);
        return (
          <Button
            key={option.value}
            id={`business-tab-${option.value}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`business-panel-${option.value}`}
            variant="ghost"
            size="sm"
            ref={itemProps.ref}
            tabIndex={activeIndex === index ? 0 : -1}
            onKeyDown={itemProps.onKeyDown}
            onFocus={itemProps.onFocus}
            onClick={itemProps.onClick}
            className={selected
              ? '!rounded-[8px] !bg-[var(--surface-3)] !px-[14px] !py-2 t-ui font-semibold !text-[var(--brand-text-bright)] shadow-[var(--shadow-md)]'
              : '!rounded-[8px] !px-[14px] !py-2 t-ui font-semibold !text-[var(--brand-text-muted)] hover:!text-[var(--brand-text)]'}
          >
            <Icon name={option.icon} size="sm" aria-hidden="true" />
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
