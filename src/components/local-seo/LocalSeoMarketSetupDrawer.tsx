import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ChevronDown, Copy, MapPin, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import type {
  LocalSeoLocationLookupCandidate,
  LocalSeoMarket,
  LocalSeoMarketStatus,
  LocalSeoPosture,
  LocalSeoReadResponse,
  LocalSeoServiceGap,
} from '../../../shared/types/local-seo';
import { buildDataForSeoLocationName } from '../../../shared/local-seo-location';
import {
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_POSTURE,
} from '../../../shared/types/local-seo';
import { useLocalSeoLocationLookup, useLocalSeoLocations, useLocalSeoRefresh, useLocalSeoUpdate, useSetPrimaryMarket } from '../../hooks/admin';
import { adminPath } from '../../routes';
import { Badge, Button, FormField, FormInput, FormSelect, Icon, IconButton, SectionCard, Skeleton, cn } from '../ui';

interface LocalSeoMarketSetupDrawerProps {
  workspaceId: string;
  data: LocalSeoReadResponse;
  open: boolean;
  onClose: () => void;
}

interface MarketDraft {
  id?: string;
  label: string;
  city: string;
  stateOrRegion: string;
  country: string;
  providerLocationCode: string;
  providerLocationName: string;
  latitude: string;
  longitude: string;
  status: LocalSeoMarketStatus;
  advancedOpen: boolean;
}

const POSTURE_OPTIONS = [
  { value: LOCAL_SEO_POSTURE.LOCAL, label: 'Local' },
  { value: LOCAL_SEO_POSTURE.HYBRID, label: 'Hybrid' },
  { value: LOCAL_SEO_POSTURE.NON_LOCAL, label: 'Non-local' },
  { value: LOCAL_SEO_POSTURE.UNKNOWN, label: 'Unknown' },
];

const STATUS_OPTIONS = [
  { value: LOCAL_SEO_MARKET_STATUS.ACTIVE, label: 'Active' },
  { value: LOCAL_SEO_MARKET_STATUS.NEEDS_REVIEW, label: 'Needs review' },
  { value: LOCAL_SEO_MARKET_STATUS.INACTIVE, label: 'Inactive' },
];

function providerLocationNameFor(market: Pick<LocalSeoMarket, 'city' | 'stateOrRegion' | 'country' | 'providerLocationName'>): string {
  if (market.providerLocationName?.trim()) return market.providerLocationName.trim();
  return buildDataForSeoLocationName(market) ?? '';
}

function draftFromMarket(market: LocalSeoMarket, forceActive = false): MarketDraft {
  return {
    id: market.id.startsWith('business-profile-') ? undefined : market.id,
    label: market.label,
    city: market.city,
    stateOrRegion: market.stateOrRegion ?? '',
    country: market.country,
    providerLocationCode: market.providerLocationCode ? String(market.providerLocationCode) : '',
    providerLocationName: providerLocationNameFor(market),
    latitude: typeof market.latitude === 'number' ? String(market.latitude) : '',
    longitude: typeof market.longitude === 'number' ? String(market.longitude) : '',
    status: forceActive ? LOCAL_SEO_MARKET_STATUS.ACTIVE : market.status,
    advancedOpen: false,
  };
}

function blankDraft(): MarketDraft {
  return {
    label: '',
    city: '',
    stateOrRegion: '',
    country: 'US',
    providerLocationCode: '',
    providerLocationName: '',
    latitude: '',
    longitude: '',
    status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
    advancedOpen: true,
  };
}

function parseClearableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasProviderIdentity(market: MarketDraft): boolean {
  return Boolean(
    market.providerLocationCode.trim()
    || market.providerLocationName.trim()
    || buildDataForSeoLocationName(market)
    || (market.latitude.trim() && market.longitude.trim())
  );
}

function marketLabel(market: MarketDraft): string {
  return market.label.trim() || [market.city, market.stateOrRegion].filter(Boolean).join(', ') || 'New market';
}

function ServiceGapNudge({ gap }: { gap: LocalSeoServiceGap }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(gap.starterKeywords.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* clipboard permission denied — silently ignore */ });
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="t-caption font-semibold text-[var(--brand-text-bright)]">{gap.serviceLabel}</p>
        <Button
          variant="ghost"
          size="sm"
          icon={copied ? Check : Copy}
          className="t-caption-sm text-teal-400 hover:text-teal-300 px-1.5 py-0.5 h-auto"
          aria-label={`Copy starter keywords for ${gap.serviceLabel}`}
          onClick={handleCopy}
        >
          {copied ? 'Copied' : 'Copy keywords'}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {gap.starterKeywords.map(kw => (
          <span key={kw} className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]">
            {kw}
          </span>
        ))}
      </div>
    </div>
  );
}

function BusinessLocationsShortcut({ workspaceId }: { workspaceId: string }) {
  const { data: locations, isLoading } = useLocalSeoLocations(workspaceId);
  const settingsLocationsUrl = `${adminPath(workspaceId, 'workspace-settings')}?tab=locations`;

  if (isLoading) {
    return (
      <SectionCard variant="subtle">
        <Skeleton className="h-5 w-56" />
      </SectionCard>
    );
  }

  const confirmedCount = Array.isArray(locations)
    ? locations.filter(location => location.status === 'confirmed').length
    : 0;
  const needsReviewCount = Array.isArray(locations)
    ? locations.filter(location => location.status === 'needs_review').length
    : 0;
  const totalCount = Array.isArray(locations) ? locations.length : 0;
  const hasNeedsReview = needsReviewCount > 0;
  const hasConfirmed = confirmedCount > 0;

  const label = hasNeedsReview
    ? `${needsReviewCount} location${needsReviewCount === 1 ? '' : 's'} need review`
    : hasConfirmed
      ? `${totalCount} location${totalCount === 1 ? '' : 's'} configured`
      : 'No locations configured';
  const description = hasNeedsReview
    ? 'Confirm your locations to improve match accuracy.'
    : hasConfirmed
      ? 'Used for local business match detection.'
      : 'Your primary domain is used for matching until locations are added.';
  const cta = hasNeedsReview ? 'Review' : hasConfirmed ? 'Manage' : 'Add locations';

  return (
    <SectionCard
      variant="subtle"
      className={hasNeedsReview ? 'border-amber-500/30 bg-amber-500/8' : undefined}
      noPadding
    >
      <div className="px-4 py-3 flex items-center justify-between gap-3" role="region" aria-label="Business locations">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon as={MapPin} size="sm" className="text-[var(--brand-text-muted)]" />
            <p className="t-caption font-semibold text-[var(--brand-text-bright)]">Business locations</p>
            {hasNeedsReview && <Badge label="Needs review" tone="amber" variant="soft" shape="pill" />}
          </div>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
            {label} - {description}
          </p>
        </div>
        <Link
          to={settingsLocationsUrl}
          className="t-caption-sm font-medium text-teal-400 hover:text-teal-300 transition-colors shrink-0 whitespace-nowrap"
          aria-label={`${cta} in Workspace Settings`}
        >
          {cta}
        </Link>
      </div>
    </SectionCard>
  );
}

export function LocalSeoMarketSetupDrawer({ workspaceId, data, open, onClose }: LocalSeoMarketSetupDrawerProps) {
  const [posture, setPosture] = useState<LocalSeoPosture>(data.settings.posture);
  const [markets, setMarkets] = useState<MarketDraft[]>([]);
  const [removedMarkets, setRemovedMarkets] = useState<MarketDraft[]>([]);
  // Per-workspace keywords-per-refresh override. Stored as a string so we can
  // distinguish "field empty" (revert to default = null) from a typed number.
  const [keywordsPerRefreshInput, setKeywordsPerRefreshInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [locationCandidatesByIndex, setLocationCandidatesByIndex] = useState<Record<number, LocalSeoLocationLookupCandidate[]>>({});
  const [lookupPendingIndex, setLookupPendingIndex] = useState<number | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const update = useLocalSeoUpdate(workspaceId);
  const refresh = useLocalSeoRefresh(workspaceId);
  const locationLookup = useLocalSeoLocationLookup(workspaceId);
  const setPrimary = useSetPrimaryMarket(workspaceId);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setPosture(data.settings.posture);
    setMarkets(data.markets.map(market => draftFromMarket(market)));
    setRemovedMarkets([]);
    setKeywordsPerRefreshInput(
      typeof data.settings.keywordsPerRefresh === 'number'
        ? String(data.settings.keywordsPerRefresh)
        : '',
    );
    setError(null);
    setLocationCandidatesByIndex({});
    setLookupPendingIndex(null);
    const frame = window.requestAnimationFrame(() => drawerRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus?.();
    };
  }, [data.markets, data.settings.posture, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter(element => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown); // keydown-ok — local SEO setup drawer intentionally traps Escape + Tab
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const activeMarketCount = useMemo(
    () => markets.filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length,
    [markets],
  );
  const canSaveAndRefresh = posture !== LOCAL_SEO_POSTURE.NON_LOCAL && activeMarketCount > 0;

  if (!open) return null;

  const setMarket = (index: number, patch: Partial<MarketDraft>) => {
    setMarkets(current => current.map((market, i) => i === index ? { ...market, ...patch } : market));
    setLocationCandidatesByIndex(current => {
      if (!(index in current)) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
  };

  const addSuggestedMarket = (market: LocalSeoMarket) => {
    const next = draftFromMarket(market, true);
    setMarkets(current => {
      const withoutDuplicate = current.filter(item => item.id !== next.id && marketLabel(item) !== market.label);
      return [...withoutDuplicate, next].slice(0, data.caps.maxMarkets);
    });
    setError(null);
  };

  const applyProviderCandidate = (index: number, candidate: LocalSeoLocationLookupCandidate) => {
    setMarket(index, {
      providerLocationCode: String(candidate.providerLocationCode),
      providerLocationName: candidate.providerLocationName,
      advancedOpen: true,
    });
    setLocationCandidatesByIndex(current => {
      const next = { ...current };
      delete next[index];
      return next;
    });
    setError(null);
  };

  const lookupProviderLocation = async (index: number, market: MarketDraft): Promise<MarketDraft | null> => {
    if (!market.city.trim() || !market.country.trim()) {
      setError(`${marketLabel(market)} needs a city and country before matching a provider location.`);
      return null;
    }
    setLookupPendingIndex(index);
    try {
      const result = await locationLookup.mutateAsync({
        city: market.city.trim(),
        stateOrRegion: market.stateOrRegion.trim() || undefined,
        country: market.country.trim(),
      });
      const best = result.bestCandidate;
      if (result.status === 'matched' && best) {
        const next = {
          ...market,
          providerLocationCode: String(best.providerLocationCode),
          providerLocationName: best.providerLocationName,
          advancedOpen: market.advancedOpen,
        };
        setMarket(index, next);
        return next;
      }
      if (result.candidates.length > 0) {
        setLocationCandidatesByIndex(current => ({ ...current, [index]: result.candidates }));
        setError(`${marketLabel(market)} matched multiple provider locations. Choose the closest match before saving.`);
        return null;
      }
      setError(result.degradedReason ?? `${marketLabel(market)} could not be matched to a provider location.`);
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : `${marketLabel(market)} provider location lookup failed.`);
      return null;
    } finally {
      setLookupPendingIndex(null);
    }
  };

  const validate = (): boolean => {
    if (posture !== LOCAL_SEO_POSTURE.NON_LOCAL && activeMarketCount === 0) {
      setError('Choose at least one active market, or mark the workspace as non-local.');
      return false;
    }
    for (const market of markets) {
      if (!market.label.trim() || !market.city.trim() || !market.country.trim()) {
        setError('Each configured market needs a label, city, and country.');
        return false;
      }
      if (market.providerLocationCode.trim() && !Number.isFinite(Number(market.providerLocationCode.trim()))) {
        setError(`${marketLabel(market)} has an invalid provider location code.`);
        return false;
      }
      if (market.latitude.trim() && !Number.isFinite(Number(market.latitude.trim()))) {
        setError(`${marketLabel(market)} has an invalid latitude.`);
        return false;
      }
      if (market.longitude.trim() && !Number.isFinite(Number(market.longitude.trim()))) {
        setError(`${marketLabel(market)} has an invalid longitude.`);
        return false;
      }
      if (market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE && !hasProviderIdentity(market)) {
        setError(`${marketLabel(market)} needs a provider location name, provider location code, or coordinates before it can be active.`);
        return false;
      }
    }
    setError(null);
    return true;
  };

  const save = async (refreshAfterSave: boolean) => {
    if (!validate()) return;
    try {
      const resolvedMarkets: MarketDraft[] = [];
      for (let index = 0; index < markets.length; index++) {
        const market = markets[index];
        if (
          market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE
          && !market.providerLocationCode.trim()
          && market.city.trim()
          && market.country.trim()
        ) {
          const resolved = await lookupProviderLocation(index, market);
          if (!resolved) return;
          resolvedMarkets.push(resolved);
        } else {
          resolvedMarkets.push(market);
        }
      }
      // Resolve the keywords-per-refresh override input. Empty → null (clear
       // override); a parseable integer in [min, max] → number; otherwise validate
       // and bail with an error before the network call.
      const trimmedBudget = keywordsPerRefreshInput.trim();
      let nextKeywordsPerRefresh: number | null = null;
      if (trimmedBudget !== '') {
        const parsed = Number(trimmedBudget);
        if (
          !Number.isInteger(parsed)
          || parsed < data.caps.keywordsPerRefreshMin
          || parsed > data.caps.keywordsPerRefreshMax
        ) {
          setError(
            `Keywords per refresh must be an integer between ${data.caps.keywordsPerRefreshMin} and ${data.caps.keywordsPerRefreshMax}, or empty to use the default.`,
          );
          return;
        }
        nextKeywordsPerRefresh = parsed;
      }
      const response = await update.mutateAsync({
        posture,
        markets: [...resolvedMarkets, ...removedMarkets].map(market => ({
          id: market.id,
          label: market.label.trim(),
          city: market.city.trim(),
          stateOrRegion: market.stateOrRegion.trim() || undefined,
          country: market.country.trim(),
          providerLocationCode: parseClearableNumber(market.providerLocationCode),
          providerLocationName: market.providerLocationName.trim() || buildDataForSeoLocationName(market) || null,
          latitude: parseClearableNumber(market.latitude),
          longitude: parseClearableNumber(market.longitude),
          status: market.status,
        })),
        keywordsPerRefresh: nextKeywordsPerRefresh,
      });
      if (refreshAfterSave) {
        await refresh.mutateAsync({
          marketIds: response.markets
            .filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE)
            .map(market => market.id),
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Local SEO market setup could not be saved.');
    }
  };

  const saving = update.isPending || refresh.isPending;
  const lookingUp = locationLookup.isPending;

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/30" // fixed-inset-ok -- local SEO drawer backdrop mirrors the existing keyword drawer pattern.
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Configure local market"
        tabIndex={-1}
        // pr-check-disable-next-line -- Brand signature radius intentional for bottom-sheet drawer top corners on mobile, matching StrategyKeywordDrawer.
        className="fixed inset-x-0 bottom-0 h-[82vh] sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-auto sm:w-full sm:max-w-lg bg-[var(--surface-2)] border-t border-[var(--brand-border)] sm:border-t-0 sm:border-l z-[var(--z-modal-fullscreen)] flex flex-col overflow-hidden duration-200 rounded-t-[var(--radius-signature-lg)] sm:rounded-none outline-none animate-in slide-in-from-right" // fixed-inset-ok -- local SEO setup uses the established mobile sheet / desktop drawer pattern above chat widgets.
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--brand-border)] flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Icon as={MapPin} size="md" className="text-teal-400" />
              <h2 className="t-page font-semibold text-[var(--brand-text-bright)]">Configure local market</h2>
            </div>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1 max-w-md">
              Choose the market we should use for local-pack visibility. This does not publish content or edit live SEO metadata.
            </p>
          </div>
          <IconButton icon={X} label="Close local market setup" variant="ghost" size="sm" onClick={onClose} />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <BusinessLocationsShortcut workspaceId={workspaceId} />

          <section className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">Workspace posture</h3>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">Admin override is authoritative for local SEO reporting.</p>
              </div>
              {data.settings.suggestedPosture && (
                <Badge label={`Suggested: ${data.settings.suggestedPosture.replace(/_/g, ' ')}`} tone="blue" variant="soft" shape="pill" />
              )}
            </div>
            <FormField label="Local SEO posture">
              <FormSelect options={POSTURE_OPTIONS} value={posture} onChange={value => setPosture(value as LocalSeoPosture)} />
            </FormField>
            {data.settings.suggestionReasons.length > 0 && (
              <div className="mt-3 space-y-1">
                {data.settings.suggestionReasons.slice(0, 3).map(reason => (
                  <p key={reason} className="t-caption-sm text-[var(--brand-text-muted)]">- {reason}</p>
                ))}
              </div>
            )}
          </section>

          {data.serviceGaps.length > 0 && (
            <section className="rounded-[var(--radius-lg)] border border-amber-500/20 bg-amber-500/8 p-4">
              <div className="flex items-start gap-2 mb-3">
                <Icon as={AlertTriangle} size="sm" className="text-amber-400 mt-0.5" />
                <div>
                  <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">
                    Uncovered services
                  </h3>
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">
                    No tracking keywords found for {data.serviceGaps.length} service{data.serviceGaps.length === 1 ? '' : 's'}.
                    Copy starter keywords to add them to Rank Tracker.
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {data.serviceGaps.map(gap => (
                  <ServiceGapNudge key={gap.serviceId} gap={gap} />
                ))}
              </div>
            </section>
          )}

          {data.suggestedMarkets.length > 0 && (
            <section className="rounded-[var(--radius-lg)] border border-blue-500/20 bg-blue-500/8 p-4">
              <div className="flex items-start gap-2 mb-3">
                <Icon as={Sparkles} size="sm" className="text-blue-400 mt-0.5" />
                <div>
                  <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">Suggested markets</h3>
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">
                    Suggested from workspace evidence. Review before using for local visibility.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {data.suggestedMarkets.map(market => (
                  <div key={market.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-blue-500/20 bg-[var(--surface-2)]/60 px-3 py-2">
                    <div>
                      <p className="t-caption font-semibold text-[var(--brand-text-bright)]">{market.label}</p>
                      <p className="t-caption-sm text-[var(--brand-text-muted)]">
                        {[market.city, market.stateOrRegion, market.country].filter(Boolean).join(', ')}
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => addSuggestedMarket(market)} disabled={markets.length >= data.caps.maxMarkets}>
                      Use this market
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">Configured markets</h3>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">Up to {data.caps.maxMarkets} active markets in v1.</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={Plus}
                disabled={markets.length >= data.caps.maxMarkets}
                onClick={() => setMarkets(current => [...current, blankDraft()])}
              >
                Add market
              </Button>
            </div>

            {markets.length === 0 ? (
              <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 px-4 py-5 text-center">
                <p className="t-caption text-[var(--brand-text-muted)]">No markets configured yet. Use a suggested market or add one manually.</p>
              </div>
            ) : markets.map((market, index) => (
              <div key={market.id ?? `new-${index}`} className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    {data.markets.find(item => item.id === market.id)?.isPrimary && (
                      <Badge label="Primary" tone="teal" variant="soft" shape="pill" />
                    )}
                    <div className="min-w-0">
                      <p className="t-caption font-semibold text-[var(--brand-text-bright)] truncate">{marketLabel(market)}</p>
                      <p className="t-caption-sm text-[var(--brand-text-muted)]">{market.status.replace(/_/g, ' ')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {market.id && market.providerLocationCode.trim() && !data.markets.find(item => item.id === market.id)?.isPrimary && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving || setPrimary.isPending}
                        onClick={() => setPrimary.mutate(market.id!)}
                      >
                        Set as primary
                      </Button>
                    )}
                    <IconButton
                      icon={Trash2}
                      label={`Remove ${marketLabel(market)}`}
                      variant="ghost"
                      size="sm"
                      className="text-[var(--brand-text-muted)] hover:text-red-400"
                      onClick={() => {
                        setMarkets(current => current.filter((_, i) => i !== index));
                        if (market.id) {
                          setRemovedMarkets(current => [
                            ...current.filter(item => item.id !== market.id),
                            { ...market, status: LOCAL_SEO_MARKET_STATUS.INACTIVE },
                          ]);
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField label="Market label" required>
                    <FormInput value={market.label} onChange={value => setMarket(index, { label: value })} placeholder="Austin, TX" />
                  </FormField>
                  <FormField label="Status">
                    <FormSelect options={STATUS_OPTIONS} value={market.status} onChange={value => setMarket(index, { status: value as LocalSeoMarketStatus })} />
                  </FormField>
                  <FormField label="City" required>
                    <FormInput value={market.city} onChange={value => setMarket(index, { city: value })} placeholder="Austin" />
                  </FormField>
                  <FormField label="State / region">
                    <FormInput value={market.stateOrRegion} onChange={value => setMarket(index, { stateOrRegion: value })} placeholder="TX" />
                  </FormField>
                  <FormField label="Country" required>
                    <FormInput value={market.country} onChange={value => setMarket(index, { country: value })} placeholder="US" />
                  </FormField>
                </div>

                <div className="rounded-[var(--radius-md)] border border-blue-500/20 bg-blue-500/8 px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="t-caption font-semibold text-[var(--brand-text-bright)]">Provider location match</p>
                      <p className="t-caption-sm text-[var(--brand-text-muted)]">
                        {market.providerLocationCode.trim()
                          ? `${market.providerLocationName || 'Matched location'} · DataForSEO #${market.providerLocationCode}`
                          : 'We can match this market to a DataForSEO location code before refreshing.'}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={lookupPendingIndex === index}
                      disabled={saving || lookingUp || !market.city.trim() || !market.country.trim()}
                      onClick={() => { void lookupProviderLocation(index, market); }}
                    >
                      Match location
                    </Button>
                  </div>
                  {locationCandidatesByIndex[index]?.length > 0 && (
                    <div className="space-y-1">
                      {locationCandidatesByIndex[index].map(candidate => (
                        <Button
                          key={candidate.providerLocationCode}
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start rounded-[var(--radius-sm)] border border-teal-500/20 bg-[var(--surface-2)]/70 px-3 py-2 text-left hover:border-teal-400/40"
                          onClick={() => applyProviderCandidate(index, candidate)}
                        >
                          <span>
                            <span className="block t-caption font-semibold text-[var(--brand-text-bright)]">{candidate.providerLocationName}</span>
                            <span className="block t-caption-sm text-[var(--brand-text-muted)]">DataForSEO #{candidate.providerLocationCode} · {candidate.locationType ?? 'location'}</span>
                          </span>
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="px-0 py-0 bg-transparent hover:bg-transparent text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
                  onClick={() => setMarket(index, { advancedOpen: !market.advancedOpen })}
                  aria-expanded={market.advancedOpen}
                >
                  <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', market.advancedOpen ? '' : '-rotate-90')} />
                  Provider identity
                </Button>

                {market.advancedOpen && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField
                      label="Provider location name"
                      hint="Example: Austin,Texas,United States"
                    >
                      <FormInput value={market.providerLocationName} onChange={value => setMarket(index, { providerLocationName: value })} />
                    </FormField>
                    <FormField label="Provider location code">
                      <FormInput value={market.providerLocationCode} onChange={value => setMarket(index, { providerLocationCode: value })} inputMode="numeric" />
                    </FormField>
                    <FormField label="Latitude">
                      <FormInput value={market.latitude} onChange={value => setMarket(index, { latitude: value })} />
                    </FormField>
                    <FormField label="Longitude">
                      <FormInput value={market.longitude} onChange={value => setMarket(index, { longitude: value })} />
                    </FormField>
                  </div>
                )}
              </div>
            ))}
          </section>

          <section className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-4">
            <div className="mb-3">
              <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">Refresh keyword budget</h3>
              <p className="t-caption-sm text-[var(--brand-text-muted)]">
                Each refresh spends ~$0.002 per keyword per market via DataForSEO. Default is {data.caps.keywordsPerRefreshDefault}; raise it for local-first clients where broader local-pack coverage matters.
              </p>
            </div>
            <FormField
              label={`Keywords per refresh (${data.caps.keywordsPerRefreshMin}–${data.caps.keywordsPerRefreshMax})`}
            >
              <FormInput
                value={keywordsPerRefreshInput}
                onChange={value => setKeywordsPerRefreshInput(value.replace(/[^0-9]/g, ''))}
                placeholder={`Default: ${data.caps.keywordsPerRefreshDefault}`}
                inputMode="numeric"
              />
            </FormField>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-2">
              {keywordsPerRefreshInput.trim() === ''
                ? `Using global default (${data.caps.keywordsPerRefreshDefault} keywords/refresh).`
                : (() => {
                    const parsed = Number(keywordsPerRefreshInput);
                    if (!Number.isInteger(parsed)) return 'Enter a whole number or leave empty for default.';
                    const activeCount = Math.max(1, markets.filter(m => m.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length);
                    const cost = (parsed * activeCount * 0.002).toFixed(2);
                    return `Estimated cost per refresh: ~$${cost} (${parsed} keywords × ${activeCount} active market${activeCount === 1 ? '' : 's'}).`;
                  })()}
            </p>
          </section>

          {(error || update.error || refresh.error) && (
            <div className="rounded-[var(--radius-lg)] border border-red-500/20 bg-red-500/8 px-4 py-3 flex items-start gap-2">
              <Icon as={AlertTriangle} size="sm" className="text-red-400/80 mt-0.5" />
              <p className="t-caption-sm text-red-400/90">
                {error
                  ?? (update.error instanceof Error ? update.error.message : null)
                  ?? (refresh.error instanceof Error ? refresh.error.message : null)
                  ?? 'Local SEO market setup could not be saved.'}
              </p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[var(--brand-border)] flex-shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            Local visibility checks are separate from Rank Tracker and strategy generation.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="secondary" size="sm" loading={(update.isPending && !refresh.isPending) || lookingUp} disabled={saving || lookingUp} onClick={() => save(false)}>
              Save market
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={refresh.isPending ? undefined : RefreshCw}
              loading={refresh.isPending}
              disabled={saving || lookingUp || !canSaveAndRefresh}
              title={!canSaveAndRefresh ? 'Choose at least one active local market before refreshing visibility.' : undefined}
              onClick={() => save(true)}
            >
              Save and refresh visibility
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
