import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './Icon';
import { Popover } from './overlay/Popover';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  trailing?: React.ReactNode;
}

export interface MenuProps {
  /**
   * A single focusable element (e.g. a <Button> or <button>). It is CLONED by the
   * underlying Popover to receive the toggle handler + ARIA (aria-haspopup,
   * aria-expanded, aria-controls), so it must be a real interactive element — not
   * a <div> or bare text — to stay keyboard-operable.
   */
  trigger: React.ReactElement;
  items: MenuItem[];
  align?: 'start' | 'end';
}

// ─── Menu component ──────────────────────────────────────────────────────────────

/**
 * Items-driven dropdown menu — a thin convenience wrapper over the accessible
 * <Popover> primitive (`src/components/ui/overlay/Popover.tsx`). Popover provides
 * the full WAI-ARIA APG menu behavior: a cloned, keyboard-operable trigger with
 * aria-haspopup/aria-expanded, roving Arrow/Home/End focus, Escape/Tab/outside-click
 * dismissal, focus-first-on-open + focus-restore-on-close, and a portaled,
 * viewport-clamped panel at z-[var(--z-dropdown)].
 *
 * Use <Menu> when you have a flat list of actions; drop to <Popover> + <Popover.Item>
 * directly when you need custom panel content or separators.
 */
export function Menu({ trigger, items, align = 'start' }: MenuProps) {
  return (
    <Popover trigger={trigger} placement={align === 'end' ? 'bottom-end' : 'bottom-start'}>
      {items.map((item) => (
        <Popover.Item key={item.label} onClick={item.onSelect}>
          <span className="flex items-center gap-2 w-full">
            {item.icon && (
              <Icon as={item.icon} size="sm" aria-hidden="true" className="shrink-0 text-[var(--brand-text-muted)]" />
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {item.trailing && (
              <span className="ml-auto shrink-0 text-[var(--brand-text-muted)]">{item.trailing}</span>
            )}
          </span>
        </Popover.Item>
      ))}
    </Popover>
  );
}
