/* ── Skeleton / Shimmer loading primitives ── */

interface SkeletonProps {
  className?: string;
}

/** A single animated placeholder bar. Use className to set width/height. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-3)] ${className ?? ''}`}
    />
  );
}

/** Skeleton that mimics a StatCard layout */
export function StatCardSkeleton({ className }: SkeletonProps) {
  return (
    <div className={`bg-[var(--surface-2)] p-4 border border-[var(--brand-border)] ${className ?? ''}`} style={{ borderRadius: 'var(--radius-signature)' }}>
      <div className="flex items-center gap-1.5 mb-3">
        <Skeleton className="w-3.5 h-3.5 rounded" />
        <Skeleton className="w-16 h-2.5" />
      </div>
      <Skeleton className="w-20 h-6 mb-2" />
      <Skeleton className="w-12 h-2" />
    </div>
  );
}

/** Skeleton that mimics a SectionCard with a few text lines */
export function SectionCardSkeleton({ lines = 3, className }: SkeletonProps & { lines?: number }) {
  return (
    // pr-check-disable-next-line -- Skeleton section cards intentionally mirror SectionCard's signature radius.
    <div className={`bg-[var(--surface-2)] border border-[var(--brand-border)] p-5 space-y-3 ${className ?? ''}`} style={{ borderRadius: 'var(--radius-signature-lg)' }}>
      <div className="flex items-center gap-2 mb-1">
        <Skeleton className="w-5 h-5 rounded-lg" />
        <Skeleton className="w-28 h-3" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-2.5 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

/** Skeleton that mimics Overview tab layout: stat cards row + content grid */
export function OverviewSkeleton() {
  return (
    <div className="space-y-5">
      {/* Header skeleton */}
      <div>
        <Skeleton className="w-48 h-5 mb-2" />
        <Skeleton className="w-72 h-3" />
      </div>
      {/* Stat cards row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-4">
          <SectionCardSkeleton lines={5} />
          <SectionCardSkeleton lines={3} />
        </div>
        <div className="lg:col-span-2 space-y-4">
          <SectionCardSkeleton lines={4} />
          <SectionCardSkeleton lines={2} />
        </div>
      </div>
    </div>
  );
}

/** Skeleton for Analytics / Performance tab: stat row + chart area */
export function AnalyticsSkeleton() {
  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      {/* Chart placeholder */}
      {/* pr-check-disable-next-line -- Analytics skeleton intentionally mirrors SectionCard's signature radius. */}
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-5" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <Skeleton className="w-32 h-3 mb-4" />
        <Skeleton className="w-full h-48 rounded-lg" />
      </div>
    </div>
  );
}
