import { MapPin, RefreshCw, Star } from 'lucide-react';
import type { GbpListingAggregate } from '../../api/localSeo';
import { useGbpReviews, useLocalGbpRefresh } from '../../hooks/admin';
import { FeatureFlag } from '../ui/FeatureFlag';
import { Badge, Button, EmptyState, Icon, SectionCard } from '../ui';
import { scoreColorClass } from '../ui/constants';

/**
 * Admin GBP + reviews readout (SEO Decision Engine P7 / local-gbp). Aggregates ONLY — own
 * rating/review-count vs the top competitor (blue DATA tone, Law 02), plus a GBP completeness
 * state (emerald/amber/red via scoreColorClass — Law 03). NO purple/violet/indigo anywhere.
 *
 * The server read endpoint returns an empty payload when the `local-gbp` flag is off, so the
 * panel simply renders nothing in that case. The "Refresh GBP & reviews" trigger is itself
 * flag-gated (mirrors P6's national-rank refresh button) and wired to useLocalGbpRefresh.
 */

function ratingLabel(listing: Pick<GbpListingAggregate, 'rating' | 'reviewCount'>): string {
  // undefined rating/count = "no reviews yet" — never invent a 0★/0-review signal.
  if (typeof listing.reviewCount !== 'number') return 'No reviews yet';
  const stars = typeof listing.rating === 'number' ? `${listing.rating.toFixed(1)}★` : '—';
  return `${stars} · ${listing.reviewCount} ${listing.reviewCount === 1 ? 'review' : 'reviews'}`;
}

function ListingRow({ label, listing }: { label: string; listing: GbpListingAggregate }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="t-caption-sm text-[var(--brand-text-muted)]">{label}</p>
        <p className="t-caption font-semibold text-[var(--brand-text-bright)] truncate">
          {listing.title ?? 'Unnamed listing'}
        </p>
      </div>
      {/* Review counts/ratings are read-only DATA → blue (Law 02). */}
      <p className="t-caption font-semibold text-blue-400 tabular-nums flex items-center gap-1 shrink-0">
        <Icon as={Star} size="xs" />
        {ratingLabel(listing)}
      </p>
    </div>
  );
}

function CompletenessReadout({ score, owned }: { score: number; owned: GbpListingAggregate }) {
  const missing: string[] = [];
  if (!owned.claimed) missing.push('listing not claimed');
  if ((owned.totalPhotos ?? 0) === 0) missing.push('no photos');
  if (owned.attributes.length === 0) missing.push('no attributes');
  if (!owned.category || !owned.category.trim()) missing.push('no category');

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">GBP completeness</p>
          {/* Completeness is a SCORE → emerald/amber/red via scoreColorClass (Law 03). */}
          <p className={`t-h2 font-semibold tabular-nums ${scoreColorClass(score)}`}>{score}/100</p>
        </div>
        <Badge
          label={owned.claimed ? 'Claimed' : 'Unclaimed'}
          tone={owned.claimed ? 'emerald' : 'amber'}
          variant="outline"
          shape="pill"
        />
      </div>
      {missing.length > 0 && (
        <p className="t-caption-sm text-[var(--brand-text-muted)] mt-2">
          Missing: {missing.join(' · ')}
        </p>
      )}
    </div>
  );
}

export function GbpReviewsPanel({ workspaceId }: { workspaceId: string }) {
  const { data } = useGbpReviews(workspaceId);
  const refresh = useLocalGbpRefresh(workspaceId);

  const owned = data?.owned ?? null;
  const competitors = data?.competitors ?? [];
  const completenessScore = data?.completenessScore ?? null;
  const topCompetitor = competitors[0];

  // Render nothing until there is at least an owned listing or a competitor — the server returns
  // an empty payload when the flag is off, so this also covers the disabled-flag case.
  if (!owned && competitors.length === 0) return null;

  const refreshButton = (
    <FeatureFlag flag="local-gbp">
      <Button
        variant="secondary"
        size="sm"
        icon={refresh.isPending ? undefined : RefreshCw}
        loading={refresh.isPending}
        disabled={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        {refresh.isPending ? 'Refreshing...' : 'Refresh GBP & reviews'}
      </Button>
    </FeatureFlag>
  );

  return (
    <SectionCard
      title="Reviews vs competitors"
      titleExtra={<Badge label="Admin only" tone="zinc" variant="soft" shape="pill" />}
      action={refreshButton}
      variant="subtle"
    >
      <div className="space-y-4">
        {owned ? (
          <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3">
            <ListingRow label="Your listing" listing={owned} />
            {topCompetitor && <ListingRow label="Top competitor" listing={topCompetitor} />}
            {topCompetitor && typeof topCompetitor.reviewCount === 'number' && (
              <p className="t-caption-sm text-[var(--brand-text-muted)]">
                {typeof owned.reviewCount === 'number'
                  ? `Review gap: ${Math.max(0, topCompetitor.reviewCount - owned.reviewCount)} behind the leader`
                  : `Leader has ${topCompetitor.reviewCount} reviews — you have none yet`}
              </p>
            )}
          </div>
        ) : (
          <EmptyState
            icon={MapPin}
            title="No owned listing yet"
            description="Run a GBP + reviews refresh to capture your Google Business Profile."
          />
        )}

        {owned && completenessScore !== null && (
          <CompletenessReadout score={completenessScore} owned={owned} />
        )}
      </div>
    </SectionCard>
  );
}
