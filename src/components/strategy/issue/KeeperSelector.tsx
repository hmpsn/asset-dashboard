/**
 * KeeperSelector — radio/segmented page-keeper picker for cannibalization issues.
 *
 * Displays all competing pages for a cannibalization issue with their position and
 * impressions, allowing the operator to explicitly choose which page to keep as the
 * canonical winner. Seeds from the existing cannibalizationKeeperPath() default in
 * CannibalizationTriage.tsx; persists the choice via useKeeperOverride.
 *
 * Used inside the Issue cockpit (strategy-the-issue flag ON). New component — no
 * primitive delivers radio/segmented page-picker with page metadata + fix-propagation.
 *
 * Lane 1E — The Issue Phase 1.
 */
import { useState } from 'react';
import { Check } from 'lucide-react';
import { Badge, Button, Icon } from '../../ui/index.js';
import { useKeeperOverride } from '../../../hooks/admin/useKeeperOverride.js';
import { normalizePageUrl } from '../../../../shared/page-address-utils.js';
import type { CannibalizationItem } from '../../../../shared/types/workspace.js';

export interface KeeperSelectorProps {
  /** The cannibalization issue whose competing pages the operator selects between. */
  item: CannibalizationItem;
  /** The workspace this issue belongs to. */
  workspaceId: string;
  /** The URL-set key for this issue (order-independent; used as the override store key). */
  urlSetKey: string;
  /** The currently inferred keeper path (from cannibalizationKeeperPath() or stored override). */
  currentKeeperPath: string | undefined;
  /** Called after a keeper is successfully saved so the parent can update its state. */
  onKeeperChanged?: (keeperPath: string) => void;
}

/**
 * KeeperSelector renders a segmented/radio list of the competing pages for a
 * cannibalization issue. The currently selected keeper is highlighted with an
 * emerald "Keep" badge; the others render as selectable option buttons.
 *
 * Tokens: teal=action, emerald=selected/win, blue=data metric, no purple.
 */
export function KeeperSelector({
  item,
  workspaceId,
  urlSetKey,
  currentKeeperPath,
  onKeeperChanged,
}: KeeperSelectorProps) {
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const { setKeeper, isSettingKeeper } = useKeeperOverride(workspaceId);
  // currentKeeperPath arrives raw (full URL / slash-variant) from cannibalizationKeeperPath();
  // the rendered rows are normalized (see uniquePages below). Normalize the keeper into the same
  // identity space so it is matched — highlighted, sorted first, and guarded against redundant writes.
  const normalizedKeeperPath = currentKeeperPath ? normalizePageUrl(currentKeeperPath) : undefined;

  function handleSelect(path: string) {
    if (path === normalizedKeeperPath || isSettingKeeper) return;
    setPendingPath(path);
    setKeeper(
      { urlSetKey, keeperPath: path },
      {
        onSuccess: () => {
          setPendingPath(null);
          onKeeperChanged?.(path);
        },
        onError: () => {
          setPendingPath(null);
        },
      },
    );
  }

  // A producer can report the same page from keyword-map and GSC evidence. The keeper workflow is
  // page-identity based, so render one option per normalized path and retain the strongest row.
  const uniquePages = Array.from(item.pages.reduce((byPath, page) => {
    const normalizedPath = normalizePageUrl(page.path);
    const normalizedPage = { ...page, path: normalizedPath };
    const current = byPath.get(normalizedPath);
    const hasBetterPosition = (normalizedPage.position ?? Infinity) < (current?.position ?? Infinity);
    const hasBetterImpressions = (normalizedPage.position ?? Infinity) === (current?.position ?? Infinity)
      && (normalizedPage.impressions ?? 0) > (current?.impressions ?? 0);
    if (!current || hasBetterPosition || hasBetterImpressions) byPath.set(normalizedPath, normalizedPage);
    return byPath;
  }, new Map<string, CannibalizationItem['pages'][number]>()).values());

  // Sort pages: keeper first, then by position (ascending), then by impressions (descending).
  const sortedPages = uniquePages.sort((a, b) => {
    const aIsKeeper = a.path === normalizedKeeperPath;
    const bIsKeeper = b.path === normalizedKeeperPath;
    if (aIsKeeper && !bIsKeeper) return -1;
    if (!aIsKeeper && bIsKeeper) return 1;
    const aPos = a.position ?? Infinity;
    const bPos = b.position ?? Infinity;
    if (aPos !== bPos) return aPos - bPos;
    return (b.impressions ?? 0) - (a.impressions ?? 0);
  });

  return (
    <div className="space-y-1.5">
      <p className="t-caption-sm text-[var(--brand-text-muted)]">
        Choose the page to keep as the canonical winner — the others will be treated as duplicates.
      </p>
      <div className="space-y-1">
        {sortedPages.map((page) => {
          const isKeeper = page.path === normalizedKeeperPath;
          const isPending = pendingPath === page.path;

          return (
            <div
              key={page.path}
              className={[
                'flex items-center justify-between gap-2 px-3 py-2 rounded-[var(--radius-lg)] border transition-colors',
                isKeeper
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-[var(--surface-3)]/40 border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]',
              ].join(' ')}
            >
              {/* Page identity */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="t-mono text-[var(--brand-text)] truncate">{page.path}</span>

                {/* Position metric (blue = data) */}
                {page.position != null && (
                  <Badge
                    tone="blue"
                    size="sm"
                    label={`#${Math.round(page.position)}`}
                  />
                )}

                {/* Impressions metric (blue = data) */}
                {page.impressions != null && page.impressions > 0 && (
                  <span className="t-caption-sm text-blue-400 flex-shrink-0">
                    {page.impressions.toLocaleString()} imp
                  </span>
                )}
              </div>

              {/* Keep indicator or selection button */}
              {isKeeper ? (
                <span className="flex items-center gap-1 t-caption-sm text-emerald-400 flex-shrink-0 font-medium">
                  <Icon as={Check} size="sm" className="text-emerald-400" />
                  Keep
                </span>
              ) : (
                <Button
                  onClick={() => handleSelect(page.path)}
                  disabled={isSettingKeeper}
                  variant="ghost"
                  size="sm"
                  className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 flex-shrink-0"
                >
                  {isPending ? 'Saving…' : 'Set as keeper'}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
