import { AlertTriangle, Check, MessageSquareReply, RefreshCw, Star } from 'lucide-react';
import {
  useGbpAuthenticatedReviews,
  useSyncGbpAuthenticatedReviews,
} from '../../hooks/admin/useGoogleBusinessProfile';
import { Badge, Button, EmptyState, ErrorState, SectionCard, StatCard } from '../ui';

function formatRating(value?: number): string {
  return typeof value === 'number' ? value.toFixed(1) : '-';
}

function formatDate(value?: string): string {
  if (!value) return 'No sync yet';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function GbpAuthenticatedReviewsPanel({ workspaceId }: { workspaceId: string }) {
  const reviews = useGbpAuthenticatedReviews(workspaceId);
  const sync = useSyncGbpAuthenticatedReviews(workspaceId);
  const data = reviews.data;
  const connection = data?.connection;
  const syncError = sync.error instanceof Error ? sync.error.message : null;

  const action = (
    <Button
      size="sm"
      variant="secondary"
      icon={RefreshCw}
      loading={sync.isPending}
      disabled={sync.isPending || !connection?.connected || !data?.mappedLocationCount}
      onClick={() => sync.mutate()}
    >
      Sync reviews
    </Button>
  );

  if (reviews.isLoading && !data) {
    return (
      <SectionCard title="Authenticated reviews" action={action} variant="subtle">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-[88px] rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-3)]/30 animate-pulse" />
          ))}
        </div>
      </SectionCard>
    );
  }

  if (reviews.isError && !data) {
    return (
      <SectionCard title="Authenticated reviews" action={action} titleExtra={<Badge label="Phase 2B" tone="zinc" variant="soft" shape="pill" />} variant="subtle">
        <ErrorState
          title="Couldn't load authenticated reviews"
          message="Check the GBP connection flags and try again."
          action={{ label: 'Retry', onClick: () => void reviews.refetch() }}
          type="data"
        />
      </SectionCard>
    );
  }

  if (!connection?.connected) {
    return (
      <SectionCard title="Authenticated reviews" action={action} titleExtra={<Badge label="Phase 2B" tone="zinc" variant="soft" shape="pill" />} variant="subtle">
        <EmptyState
          icon={AlertTriangle}
          title="Connect Google Business Profile first"
          description="Authenticated review sync starts after the workspace has a connected Google Business Profile account."
        />
      </SectionCard>
    );
  }

  if (!data?.mappedLocationCount) {
    return (
      <SectionCard title="Authenticated reviews" action={action} titleExtra={<Badge label="Phase 2B" tone="zinc" variant="soft" shape="pill" />} variant="subtle">
        <EmptyState
          icon={Star}
          title="Map a GBP location first"
          description="Review sync only runs for GBP locations mapped to this workspace."
        />
      </SectionCard>
    );
  }

  const partial = data.locations.some(location => location.syncStatus === 'partial');
  const failed = data.locations.some(location => location.syncStatus === 'failed');

  return (
    <SectionCard
      title="Authenticated reviews"
      action={action}
      titleExtra={<Badge label={partial ? 'Partial sync' : failed ? 'Needs attention' : 'Admin only'} tone={failed ? 'amber' : 'zinc'} variant="soft" shape="pill" />}
      variant="subtle"
    >
      <div className="space-y-4">
        {syncError && (
          <div role="alert" className="rounded-[var(--radius-md)] border border-red-500/40 bg-red-500/10 px-4 py-3">
            <p className="t-caption font-semibold text-red-400">{syncError}</p>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Average" value={formatRating(data.aggregate.averageRating)} icon={Star} iconColor="#60a5fa" valueColor="text-blue-400" sub={`${data.aggregate.totalReviewCount} total`} />
          <StatCard label="Stored" value={data.aggregate.storedReviewCount} icon={Star} iconColor="#60a5fa" valueColor="text-blue-400" sub="synced review subset" />
          <StatCard label="Stored unanswered" value={data.aggregate.unansweredCount} icon={MessageSquareReply} iconColor="#f59e0b" valueColor={data.aggregate.unansweredCount > 0 ? 'text-amber-400' : 'text-emerald-400'} sub="need reply triage" />
          <StatCard label="Stored low rating" value={data.aggregate.lowRatingCount} icon={AlertTriangle} iconColor="#f87171" valueColor={data.aggregate.lowRatingCount > 0 ? 'text-red-400' : 'text-emerald-400'} sub={`Newest ${formatDate(data.aggregate.newestReviewAt)}`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.locations.map(location => (
            <div key={location.googleLocationId} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="t-caption font-semibold text-[var(--brand-text-bright)] truncate">
                    {location.location.title ?? location.location.resourceName}
                  </p>
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">
                    {location.storedReviewCount} stored · {location.unansweredCount} unanswered
                  </p>
                </div>
                <Badge
                  label={location.syncStatus.replace(/_/g, ' ')}
                  tone={location.syncStatus === 'synced' ? 'emerald' : location.syncStatus === 'failed' ? 'amber' : 'zinc'}
                  variant="soft"
                  shape="pill"
                  icon={location.syncStatus === 'synced' ? Check : undefined}
                />
              </div>
              {location.lastError && <p className="t-caption-sm text-amber-400 mt-2">{location.lastError}</p>}
            </div>
          ))}
        </div>

        {data.recentReviews.length > 0 ? (
          <div className="space-y-2">
            <p className="t-label text-[var(--brand-text-muted)]">Recent review excerpts</p>
            {data.recentReviews.slice(0, 5).map(review => (
              <div key={review.id} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)]/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="t-caption font-semibold text-blue-400">{review.ratingValue ?? '-'} star</p>
                  <Badge label={review.hasReply ? 'Replied' : 'Unanswered'} tone={review.hasReply ? 'emerald' : 'amber'} variant="soft" shape="pill" />
                </div>
                <p className="t-caption-sm text-[var(--brand-text-muted)] mt-2">
                  {review.commentExcerpt ?? 'No review text provided.'}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Star}
            title="No authenticated reviews synced yet"
            description="Sync reviews after Google approves API access to populate per-location triage."
          />
        )}

        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          {data.copyPolicy.guidance}
        </p>
      </div>
    </SectionCard>
  );
}
