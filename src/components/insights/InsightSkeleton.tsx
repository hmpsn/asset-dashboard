import { Skeleton } from '../ui';

export function InsightSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-[var(--surface-2)]/50 border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2.5 flex items-center gap-3">
          <Skeleton className="w-7 h-7 rounded-[var(--radius-sm)] flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-5 w-16 rounded flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}
