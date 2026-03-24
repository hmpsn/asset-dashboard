import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { EmptyState } from './EmptyState';

interface DataListItem {
  label: string;
  value: string | number;
  sub?: string;
  valueColor?: string;
  extra?: ReactNode;
}

interface DataListProps {
  items: DataListItem[];
  ranked?: boolean;
  maxHeight?: string;
  className?: string;
}

export function DataList({ items, ranked = true, maxHeight = '300px', className }: DataListProps) {
  return (
    <div className={`space-y-0.5 overflow-y-auto ${className ?? ''}`} style={{ maxHeight }}>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 text-xs py-1.5">
          {ranked && (
            <span className="text-zinc-500 w-5 text-right flex-shrink-0 tabular-nums">{i + 1}</span>
          )}
          <span className="text-zinc-300 truncate flex-1 min-w-0" title={item.label}>{item.label}</span>
          {item.sub && <span className="text-zinc-500 flex-shrink-0 text-[11px]">{item.sub}</span>}
          <span className={`flex-shrink-0 tabular-nums ${item.valueColor ?? 'text-zinc-400'}`}>{item.value}</span>
          {item.extra}
        </div>
      ))}
      {items.length === 0 && <EmptyState icon={FileText} title="No data available" className="py-4" />}
    </div>
  );
}
