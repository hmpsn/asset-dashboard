import { ArrowUpRight } from 'lucide-react';
import { Button } from '../../ui';

interface Props {
  title: string;
  items: string[];
  className?: string;
  onOpenItem?: (item: string) => void;
}

export function BriefSection({ title, items, className = '', onOpenItem }: Props) {
  if (items.length === 0) return null;
  return (
    <div className={`mb-6 ${className}`}>
      <h3 className="t-caption-sm font-semibold uppercase tracking-wider text-[var(--brand-text-muted)] mb-3">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 t-caption-sm text-[var(--brand-text-bright)] leading-relaxed">
            <span className="mt-1.5 shrink-0 w-1 h-1 rounded-[var(--radius-pill)] bg-[var(--brand-text-muted)]" />
            <div className="flex-1 min-w-0">
              <p>{item}</p>
              {onOpenItem && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 px-2 py-1 t-caption-sm text-accent-brand"
                  icon={ArrowUpRight}
                  onClick={() => onOpenItem(item)}
                >
                  Open source tab
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
