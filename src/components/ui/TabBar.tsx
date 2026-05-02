import type { LucideIcon } from 'lucide-react';

interface Tab {
  id: string;
  label: string;
  icon?: LucideIcon;
}

interface TabBarProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function TabBar({ tabs, active, onChange, className }: TabBarProps) {
  return (
    <div role="tablist" className={`flex items-center gap-1 border-b border-[var(--brand-border)] ${className ?? ''}`}>
      {tabs.map(t => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              const idx = tabs.findIndex(tab => tab.id === t.id);
              if (e.key === 'ArrowRight' && idx < tabs.length - 1) { onChange(tabs[idx + 1].id); e.preventDefault(); }
              if (e.key === 'ArrowLeft' && idx > 0) { onChange(tabs[idx - 1].id); e.preventDefault(); }
            }}
            className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] t-caption font-medium border-b-2 transition-colors -mb-px ${
              isActive
                ? 'border-[var(--teal)] text-[var(--teal)]'
                : 'border-transparent text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5" />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
