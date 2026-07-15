// @ds-rebuilt
import { useMemo } from 'react';
import { matchPageIdentity } from '../../../shared/page-address-utils';
import type { Recommendation } from '../../../shared/types/recommendations';
import type { CannibalizationItem } from '../../../shared/types/workspace';
import { Badge, Button, Drawer, GroupBlock, Icon, InlineBanner, ProvenanceChip } from '../ui';
import { cannibalizationKeeperPath } from '../strategy/CannibalizationTriage';

interface EngineMoveDrawerProps {
  open: boolean;
  rec: Recommendation | null;
  cannibalizationEntries: CannibalizationItem[];
  onClose: () => void;
}

function relatedCannibalizationEntries(rec: Recommendation | null, entries: CannibalizationItem[]): CannibalizationItem[] {
  if (!rec || rec.type !== 'cannibalization') return [];
  if (!rec.targetKeyword) return entries;
  return entries.filter(entry => entry.keyword.toLowerCase() === rec.targetKeyword?.toLowerCase());
}

function sourceLabel(source: string | undefined): string {
  if (!source) return 'Recommendation engine';
  return source
    .replace(/[:_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function EngineMoveDrawer({
  open,
  rec,
  cannibalizationEntries,
  onClose,
}: EngineMoveDrawerProps) {
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
        <div className="flex justify-end">
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
          message="Choose a move from the queue to review its evidence."
        />
      ) : (
        <div className="space-y-4">
          <GroupBlock
            title="Why this move is here"
            meta="Priority, impact, and the evidence behind this recommendation"
            stats={[
              { label: 'priority', value: rec.priority.replace(/_/g, ' '), color: 'var(--teal)' },
              { label: 'impact', value: Math.round(rec.impactScore), color: 'var(--blue)' },
            ]}
          >
            <div className="space-y-3 px-2 py-1">
              <p className="m-0 t-body text-[var(--brand-text)]">
                {rec.insight || rec.description}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <ProvenanceChip basis="estimate" />
                <span className="t-caption-sm text-[var(--brand-text-muted)]">
                  Source: {sourceLabel(rec.source)}
                </span>
              </div>
            </div>
          </GroupBlock>

          {rec.type === 'cannibalization' && (
            <GroupBlock
              title="Cannibalization evidence"
              meta="Competing pages and the inferred keeper behind this recommendation"
              flag={{ label: `${relatedEntries.length} issue${relatedEntries.length === 1 ? '' : 's'}` }}
            >
              <div>
                {relatedEntries.length === 0 ? (
                  <InlineBanner
                    tone="info"
                    title="No matching cannibalization issue"
                    message="This strategy read does not include detailed competing-page evidence for the recommendation."
                  />
                ) : (
                  relatedEntries.map((item) => {
                    const keeperPath = cannibalizationKeeperPath(item);
                    return (
                      <section
                        key={`${item.keyword}:${item.pages.map((page) => page.path).join('|')}`}
                        className="border-t border-[var(--brand-border)] px-4 py-4 first:border-t-0"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Icon name="target" size="sm" className="text-[var(--blue)]" />
                            <h3 className="m-0 t-ui font-semibold text-[var(--brand-text-bright)]">
                              {item.keyword}
                            </h3>
                          </div>
                          <Badge
                            label={item.severity}
                            tone={item.severity === 'high' ? 'red' : item.severity === 'medium' ? 'amber' : 'zinc'}
                            size="sm"
                          />
                        </div>

                        <p className="mb-0 mt-2 t-body text-[var(--brand-text-muted)]">
                          {item.recommendation}
                        </p>

                        <div className="mt-3 divide-y divide-[var(--brand-border)] border-y border-[var(--brand-border)]">
                          {item.pages.map((page) => {
                            const isKeeper = keeperPath
                              ? matchPageIdentity(page.path, keeperPath)
                              : false;
                            return (
                              <div key={page.path} className="flex items-center justify-between gap-3 py-2.5">
                                <div className="min-w-0">
                                  <div className="truncate t-mono text-[var(--brand-text)]">{page.path}</div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 t-caption-sm text-[var(--brand-text-muted)]">
                                    {page.position != null && <span>Position #{Math.round(page.position)}</span>}
                                    {page.impressions != null && page.impressions > 0 && (
                                      <span className="text-[var(--blue)]">{page.impressions.toLocaleString()} impressions</span>
                                    )}
                                  </div>
                                </div>
                                <Badge
                                  label={isKeeper ? 'Keeper' : 'Competing'}
                                  tone={isKeeper ? 'emerald' : 'zinc'}
                                  variant="soft"
                                  size="sm"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })
                )}
              </div>
            </GroupBlock>
          )}
        </div>
      )}
    </Drawer>
  );
}
