import { MapPin, RefreshCw, Star } from 'lucide-react';
import type { GbpListingAggregate } from '../../api/localSeo';
import { useGbpReviews, useLocalGbpRefresh } from '../../hooks/admin';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
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
  // Claim status is intentionally NOT shown — business_listings_search defaults to is_claimed=true,
  // so unclaimed owners aren't returned and `claimed` is never reliably false (P7 scaled review).
  // The readout frames profile RICHNESS: the concrete missing signals Google uses to rank/display.
  const missing: string[] = [];
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

  const flagOn = useFeatureFlag('local-gbp');
  const owned = data?.owned ?? null;
  const competitors = data?.competitors ?? [];
  const completenessScore = data?.completenessScore ?? null;
  const topCompetitor = competitors[0];

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

  // Surface a failed refresh (mirrors P6's actionErrorMessage band). The route throws an
  // ApiError on 403 (tier) / 404 (flag) / 409 (already-running) — without this band every
  // failure was swallowed and the click looked dead.
  const refreshError = refresh.error instanceof Error ? refresh.error.message : null;
  const errorBand = refreshError ? (
    <div role="alert" className="rounded-[var(--radius-xl)] border border-red-500/40 bg-red-500/10 px-4 py-3">
      <p className="t-caption font-semibold text-red-400">{refreshError}</p>
    </div>
  ) : null;

  // No listings captured yet. With the flag OFF the panel stays hidden (the server also
  // returns an empty payload then). With the flag ON, render the card with JUST the refresh
  // trigger + an empty state — otherwise the bootstrap button lives below this return and the
  // first GBP refresh could never be kicked off from the UI (chicken-and-egg).
  if (!owned && competitors.length === 0) {
    if (!flagOn) return null;
    return (
      <SectionCard
        title="Reviews vs competitors"
        titleExtra={<Badge label="Admin only" tone="zinc" variant="soft" shape="pill" />}
        action={refreshButton}
        variant="subtle"
      >
        <div className="space-y-4">
          {errorBand}
          <EmptyState
            icon={MapPin}
            title="No GBP data yet"
            description="Add an active local market with coordinates first (Configure market), then run a GBP + reviews refresh to capture your Google Business Profile and competitor listings."
          />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Reviews vs competitors"
      titleExtra={<Badge label="Admin only" tone="zinc" variant="soft" shape="pill" />}
      action={refreshButton}
      variant="subtle"
    >
      <div className="space-y-4">
        {errorBand}
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
