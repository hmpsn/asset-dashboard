// @ds-rebuilt
import { useMemo, useState } from 'react';
import { cannibalizationUrlSetKey, matchPageIdentity } from '../../../shared/page-address-utils';
import type { Recommendation } from '../../../shared/types/recommendations';
import type { CannibalizationItem } from '../../../shared/types/workspace';
import { Button, Drawer, GroupBlock, Icon, InlineBanner, ProvenanceChip } from '../ui';
import { CockpitRow } from '../strategy/CockpitRow';
import { CannibalizationTriage } from '../strategy/CannibalizationTriage';
import { KeeperSelector } from '../strategy/issue/KeeperSelector';
import type { CockpitActions } from '../strategy/cockpitTypes';

interface EngineMoveDrawerProps {
  open: boolean;
  rec: Recommendation | null;
  workspaceId: string;
  actions: CockpitActions;
  cannibalizationEntries: CannibalizationItem[];
  onClose: () => void;
}

function keeperPathOf(item: CannibalizationItem): string | undefined {
  if (item.canonicalPath && item.pages.some(page => matchPageIdentity(page.path, item.canonicalPath!))) {
    return item.canonicalPath;
  }
  const ranked = [...item.pages]
    .filter(page => page.position != null)
    .sort((a, b) =>
      (a.position! - b.position!) ||
      ((b.clicks ?? 0) - (a.clicks ?? 0)) ||
      ((b.impressions ?? 0) - (a.impressions ?? 0)));
  return (ranked[0] ?? item.pages[0])?.path;
}

function relatedCannibalizationEntries(rec: Recommendation | null, entries: CannibalizationItem[]): CannibalizationItem[] {
  if (!rec || rec.type !== 'cannibalization') return [];
  if (!rec.targetKeyword) return entries;
  return entries.filter(entry => entry.keyword.toLowerCase() === rec.targetKeyword?.toLowerCase());
}

export function EngineMoveDrawer({
  open,
  rec,
  workspaceId,
  actions,
  cannibalizationEntries,
  onClose,
}: EngineMoveDrawerProps) {
  const [keeperOverrides, setKeeperOverrides] = useState<Record<string, string>>({});
  const relatedEntries = useMemo(
    () => relatedCannibalizationEntries(rec, cannibalizationEntries),
    [cannibalizationEntries, rec],
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={rec?.title ?? 'Move detail'}
      subtitle={rec ? rec.type.replace(/_/g, ' ') : undefined}
      eyebrow="Engine move"
      width="min(720px, 100vw)"
      footer={(
        <div className="flex items-center justify-between gap-3">
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            Row actions reuse the existing recommendation lifecycle routes.
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    >
      {!rec ? (
        <InlineBanner
          tone="info"
          title="No move selected"
          message="Choose a move from the queue to review its lifecycle actions."
        />
      ) : (
        <div className="space-y-4">
          <CockpitRow rec={rec} actions={actions} />

          <GroupBlock
            title="Move provenance"
            meta="Recommendation store identity and persisted outcome basis"
            stats={[
              { label: 'priority', value: rec.priority.replace(/_/g, ' '), color: 'var(--teal)' },
              { label: 'impact', value: Math.round(rec.impactScore), color: 'var(--blue)' },
            ]}
          >
            <div className="flex flex-wrap items-center gap-2 px-2 py-1">
              <ProvenanceChip basis="estimate" />
              <span className="t-caption-sm text-[var(--brand-text-muted)]">
                Source: {rec.source || 'recommendation engine'}
              </span>
            </div>
          </GroupBlock>

          {rec.type === 'cannibalization' && (
            <GroupBlock
              title="Cannibalization controls"
              meta="Send, resolve, editor fix, and keeper override stay with the move"
              flag={{ label: `${relatedEntries.length} issue${relatedEntries.length === 1 ? '' : 's'}` }}
            >
              <div className="space-y-4">
                {relatedEntries.length === 0 ? (
                  <InlineBanner
                    tone="info"
                    title="No matching cannibalization issue"
                    message="The recommendation is still actionable, but this strategy read has no detailed competing-page issue attached."
                  />
                ) : (
                  <>
                    <CannibalizationTriage entries={relatedEntries} workspaceId={workspaceId} />
                    {relatedEntries.map((item) => {
                      const urlSetKey = cannibalizationUrlSetKey(item.pages.map(page => page.path));
                      const currentKeeperPath = keeperOverrides[urlSetKey] ?? keeperPathOf(item);
                      return (
                        <div
                          key={urlSetKey}
                          className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3"
                        >
                          <div className="mb-2 flex items-center gap-2">
                            <Icon name="target" size="sm" className="text-[var(--teal)]" />
                            <span className="t-ui font-semibold text-[var(--brand-text-bright)]">
                              {item.keyword}
                            </span>
                          </div>
                          <KeeperSelector
                            item={item}
                            workspaceId={workspaceId}
                            urlSetKey={urlSetKey}
                            currentKeeperPath={currentKeeperPath}
                            onKeeperChanged={(keeperPath) =>
                              setKeeperOverrides((current) => ({ ...current, [urlSetKey]: keeperPath }))}
                          />
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </GroupBlock>
          )}
        </div>
      )}
    </Drawer>
  );
}
