import { Fragment, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, FilterX } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton, SectionCard } from './ui/index';
import type { SprintData } from '../../shared/types/roadmap';
import type { RoadmapFilters } from '../lib/roadmapFilters';
import { matchesFilters } from '../lib/roadmapFilters';
import { priorityBadge, STATUS_ICON, FeatureChip, TagChip } from '../lib/roadmapConstants';

interface Props {
  sprints: SprintData[];
  filters: RoadmapFilters;
  featureMap: Map<number, string>;
  onToggleStatus: (itemId: number | string, sprintId: string) => void;
}

/** Compound identifier — item.id alone is not unique across sprints. */
const compoundKey = (sprintId: string, itemId: number | string) => `${sprintId}::${itemId}`;

export function RoadmapSprintView({ sprints, filters, featureMap, onToggleStatus }: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const visibleSprints = sprints.filter(sprint =>
    sprint.items.some(item => matchesFilters(item, filters, sprint.id)),
  );

  if (visibleSprints.length === 0) {
    return (
      <EmptyState
        icon={FilterX}
        title="No items match the current filters"
        description="Try clearing one or more filters to see more roadmap items."
      />
    );
  }

  return (
    <div className="space-y-8">
      {visibleSprints.map(sprint => {
        const filteredItems = sprint.items.filter(item =>
          matchesFilters(item, filters, sprint.id),
        );
        const done = sprint.items.filter(i => i.status === 'done').length;
        const total = sprint.items.length;

        return (
          <div key={sprint.id}>
            {/* Sprint section header */}
            <div className="flex items-center gap-3 pb-2 border-b border-[var(--brand-border)]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--brand-text-bright)] uppercase tracking-wide">
                    {sprint.name}
                  </span>
                  <span className="t-caption text-[var(--brand-text-muted)]">{done}/{total} done</span>
                  {done === total && total > 0 && (
                    <CheckCircle2 className="w-3 h-3 text-accent-success" />
                  )}
                </div>
                {sprint.rationale && (
                  <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 truncate">{sprint.rationale}</p>
                )}
              </div>
              {sprint.hours && (
                <span className="t-caption text-[var(--brand-text-muted)] flex-shrink-0">{sprint.hours} hrs</span>
              )}
            </div>

            {/* Item list. The divide-y must wrap the rows directly — putting it on
                SectionCard's outer div is a no-op because SectionCard wraps all
                children in a single inner padding div, leaving no siblings to divide. */}
            <SectionCard variant="subtle" noPadding className="mt-2">
              <div className="divide-y divide-[var(--brand-border)]">
              {filteredItems.map(item => {
                const pb = priorityBadge(item.priority);
                const featureName = item.featureId != null ? featureMap.get(item.featureId) : undefined;
                const key = compoundKey(sprint.id, item.id);
                const isExpanded = expandedKey === key;
                const description = item.notes?.trim();
                return (
                  <Fragment key={key}>
                    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-3)] transition-colors">
                      <span className="t-caption-sm font-mono text-[var(--brand-text-muted)] w-10 flex-shrink-0 text-right">
                        #{item.id}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleStatus(item.id, sprint.id)}
                        disabled={item.status === 'deferred'}
                        className="flex-shrink-0 hover:scale-110 px-0 py-0 bg-transparent hover:bg-transparent"
                        title={item.status === 'deferred' ? 'Status: on hold — re-open when its documented trigger is met' : `Status: ${item.status} — click to cycle`}
                      >
                        {STATUS_ICON[item.status]}
                      </Button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-xs font-medium ${
                              item.status === 'done' ? 'text-[var(--brand-text-muted)] line-through' : 'text-[var(--brand-text-bright)]'
                            }`}
                          >
                            {item.title}
                          </span>
                          <Badge label={pb.label} tone={pb.color} />
                          {featureName && <FeatureChip>{featureName}</FeatureChip>}
                          {item.tags?.map(tag => (
                            <TagChip key={tag}>{tag}</TagChip>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <div className="t-caption text-[var(--brand-text-muted)]">{item.est}</div>
                        <IconButton
                          onClick={() => setExpandedKey(isExpanded ? null : key)}
                          aria-expanded={isExpanded}
                          label={isExpanded ? `Collapse details for ${item.title}` : `Expand details for ${item.title}`}
                          icon={isExpanded ? ChevronDown : ChevronRight}
                          size="sm"
                          variant="ghost"
                          className={isExpanded ? 'text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)]'}
                        />
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 pb-3">
                        <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2 space-y-1.5">
                          <p className="t-caption text-[var(--brand-text-bright)] leading-relaxed">
                            <span className="t-caption-sm font-semibold uppercase tracking-wide text-[var(--brand-text-muted)]">Description:</span>{' '}
                            {description || 'No description added yet.'}
                          </p>
                          <div className="flex items-center gap-4 t-caption-sm text-[var(--brand-text-muted)]">
                            {item.source && <span>Source: {item.source}</span>}
                            {item.shippedAt && <span>Shipped: {item.shippedAt}</span>}
                          </div>
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
              </div>
            </SectionCard>
          </div>
        );
      })}
    </div>
  );
}
