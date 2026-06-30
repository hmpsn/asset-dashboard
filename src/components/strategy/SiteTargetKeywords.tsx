import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, Loader2, Check, Plus, ArrowUpRight, X, Heart, BookmarkPlus } from 'lucide-react';
import { Badge, Button, SectionCard, Icon, IconButton, InlineBanner, FormInput } from '../ui';
import { kdColor } from '../page-intelligence/pageIntelligenceDisplay';
import { keywordTrackingKey } from '../../lib/keywordTracking';
import { buildHubDeepLinkQuery } from '../../lib/keywordHubDeepLink';
import { adminPath } from '../../routes';
import { useShowMore } from '../../hooks/useShowMore';
import type { SiteTargetKeywordsProps } from './types';

/**
 * P3 Lane C — two visual states per keyword row (DISPLAY ONLY; mutation controls are Lane D).
 *
 *  In Set    → teal dot + "In Set" badge  (keyword is in the managed set, removedAt IS NULL)
 *  Candidate → no annotation              (keyword is not in the managed set at all)
 *
 * `managedKeywordSet` is the full ActiveStrategyKeyword[] from useStrategyKeywordSet (Lane D hook).
 * ActiveStrategyKeyword always has removedAt === null, so `'removed'` is not reachable with the
 * current prop type. Lane D widens managedKeywordSet to include removed rows when that state is needed.
 * When absent, the component is byte-identical to its pre-P3 form.
 */
type ManagedState = 'in_set' | 'candidate';

function getManagedState(kw: string, managedKeywordSet: SiteTargetKeywordsProps['managedKeywordSet']): ManagedState {
  if (!managedKeywordSet) return 'candidate';
  // Normalize for comparison: lowercase-trimmed, same as the table's stored keyword.
  const norm = kw.toLowerCase().trim();
  // The set contains ActiveStrategyKeyword (removedAt === null). Full StrategyKeywordSetRow
  // rows with removedAt non-null won't appear here (they're filtered out by the hook).
  // To display "Removed" state we'd need the full set — but the prop only carries active rows.
  // Per the prop contract (managedKeywordSet?: ActiveStrategyKeyword[]) we only know "in set"
  // vs "not in active set". "Removed" state requires Lane D to pass a wider dataset;
  // for now: in_set if present, candidate otherwise. Lane D can extend the prop later.
  const found = managedKeywordSet.find(row => row.keyword === norm);
  return found ? 'in_set' : 'candidate';
}

export function SiteTargetKeywords({
  workspaceId,
  siteKeywords,
  siteKeywordMetrics,
  trackedKeywords,
  trackingPending,
  trackingErrors,
  onTrack,
  maxVisible,
  managedKeywordSet,
  onRemoveFromSet,
  onKeepInSet,
  onAddToSet,
  managedSetEnabled,
}: SiteTargetKeywordsProps) {
  const navigate = useNavigate();
  const { visible, hiddenCount, expanded, toggle, canExpand } = useShowMore(siteKeywords, maxVisible);

  // Search-and-add state — only rendered when managedSetEnabled is true (Lane D mutation controls).
  const [addInput, setAddInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const handleAddKeyword = () => {
    const kw = addInput.trim();
    if (!kw) {
      setAddError('Enter a keyword to add.');
      return;
    }
    setAddError(null);
    onAddToSet?.(kw, 'manual_add');
    setAddInput('');
  };

  return (
    <SectionCard
      title="Site Target Keywords"
      titleIcon={<Icon as={Target} size="md" className="text-accent-brand" />}
    >
      {/* Lane D — Search-and-add input (flag-ON only, mutation control) */}
      {managedSetEnabled && (
        <div className="mb-3 flex items-center gap-2">
          <FormInput
            value={addInput}
            onChange={(val: string) => { setAddInput(val); setAddError(null); }}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') handleAddKeyword(); }}
            placeholder="Add keyword to set…"
            aria-label="Add keyword to managed set"
            className="flex-1 t-caption-sm"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={handleAddKeyword}
            aria-label="Add keyword"
          >
            <Icon as={BookmarkPlus} size="sm" className="mr-1" />
            Add
          </Button>
          {addError && (
            <InlineBanner size="sm" icon={false} className="ml-2">
              {addError}
            </InlineBanner>
          )}
        </div>
      )}

      <div className="space-y-1">
        {visible.map((kw: string, i: number) => {
          const key = keywordTrackingKey(kw);
          const metrics = siteKeywordMetrics?.find((m: { keyword: string; volume: number; difficulty: number }) => keywordTrackingKey(m.keyword) === key);
          const tracked = trackedKeywords.has(key);
          const isPendingTrack = trackingPending.has(key);
          const trackError = trackingErrors.get(key);
          const managedState: ManagedState = getManagedState(kw, managedKeywordSet);

          // Lane C: look up source annotation for 'regen_computed' keywords
          const setRow = managedKeywordSet?.find(r => r.keyword === kw.toLowerCase().trim());
          const isRegenComputed = setRow?.source === 'regen_computed';

          return (
            <div key={i} className="flex flex-col gap-0.5">
              <div className="inline-flex items-center gap-1.5 t-caption-sm text-accent-brand">
                {/* Managed-set state indicator — DISPLAY ONLY */}
                {managedState === 'in_set' && (
                  <>
                    {/* Teal dot — Four Laws: teal for active/in-set state */}
                    <span
                      className="w-1.5 h-1.5 rounded-[var(--radius-pill)] bg-teal-400 flex-shrink-0"
                      aria-hidden="true"
                      data-testid="managed-set-dot"
                    />
                    <Badge label="In Set" tone="teal" size="sm" variant="soft" />
                  </>
                )}
                {/* Lane D — "Added from opportunities" annotation for regen_computed source */}
                {managedSetEnabled && managedState === 'in_set' && isRegenComputed && (
                  <span className="t-caption-sm text-[var(--brand-text-muted)] italic">
                    Added from opportunities
                  </span>
                )}
                {/* Lane D widens managedKeywordSet to include removed rows when 'removed' state is needed */}

                <Badge label={kw} tone="teal" />
                {metrics && (metrics.volume > 0 || metrics.difficulty > 0) && (
                  <>
                    {metrics.volume > 0 && <span className="t-caption-sm text-[var(--brand-text-muted)] font-mono">{metrics.volume.toLocaleString()}/mo</span>}
                    {metrics.difficulty > 0 && <span className={`t-caption-sm font-mono ${kdColor(metrics.difficulty)}`}>KD {metrics.difficulty}%</span>}
                  </>
                )}
                <IconButton
                  onClick={() => onTrack(kw)}
                  title={isPendingTrack ? 'Adding...' : tracked ? 'Tracking' : 'Track'}
                  label={isPendingTrack ? 'Adding...' : tracked ? 'Tracking' : 'Track'}
                  icon={isPendingTrack ? Loader2 : tracked ? Check : Plus}
                  size="sm"
                  variant="ghost"
                  disabled={isPendingTrack}
                  className={`ml-0.5 ${isPendingTrack ? 'animate-spin text-[var(--brand-text-muted)]' : tracked ? 'text-accent-success' : 'text-[var(--brand-text-muted)] hover:text-accent-brand'}`}
                />
                <IconButton
                  onClick={() => navigate(adminPath(workspaceId, 'seo-keywords') + buildHubDeepLinkQuery({ keyword: kw }))}
                  title="View in Hub"
                  label="View in Hub"
                  icon={ArrowUpRight}
                  size="sm"
                  variant="ghost"
                  className="ml-0.5 text-[var(--brand-text-muted)] hover:text-accent-brand"
                />

                {/* Lane D — mutation controls (flag-ON only) */}
                {managedSetEnabled && (
                  <>
                    {managedState === 'in_set' ? (
                      <>
                        {/* Keep: stamps keptAt — survives regen */}
                        <IconButton
                          onClick={() => onKeepInSet?.(kw)}
                          title={setRow?.keptAt ? 'Kept' : 'Keep in set'}
                          label={setRow?.keptAt ? 'Kept' : 'Keep in set'}
                          icon={Heart}
                          size="sm"
                          variant="ghost"
                          className={`ml-0.5 ${setRow?.keptAt ? 'text-emerald-400' : 'text-[var(--brand-text-muted)] hover:text-accent-brand'}`}
                          aria-pressed={!!setRow?.keptAt}
                        />
                        {/* Remove: soft-delete from set */}
                        <IconButton
                          onClick={() => onRemoveFromSet?.(kw)}
                          title="Remove from set"
                          label="Remove from set"
                          icon={X}
                          size="sm"
                          variant="ghost"
                          className="ml-0.5 text-[var(--brand-text-muted)] hover:text-red-400"
                        />
                      </>
                    ) : (
                      /* Candidate → add to set (manual_add) */
                      <IconButton
                        onClick={() => onAddToSet?.(kw, 'manual_add')}
                        title="Add to set"
                        label="Add to set"
                        icon={BookmarkPlus}
                        size="sm"
                        variant="ghost"
                        className="ml-0.5 text-[var(--brand-text-muted)] hover:text-accent-brand"
                      />
                    )}
                  </>
                )}
              </div>
              {trackError && (
                <InlineBanner size="sm" icon={false} className="mt-1">
                  {trackError}
                </InlineBanner>
              )}
            </div>
          );
        })}
      </div>
      {canExpand && (
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-expanded={expanded}
          className="mt-3 w-full text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </Button>
      )}
    </SectionCard>
  );
}
