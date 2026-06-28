/**
 * Shared admin recommendation row + OV breakdown, extracted from AdminRecommendationQueue
 * so both the WorkspaceHome queue and the Strategy Decision Queue render recs identically.
 *
 * Renders the full OpportunityScore including emvPerWeek — ADMIN SURFACES ONLY.
 */
import { useState } from 'react';
import { RotateCcw, ChevronDown, ChevronRight, ArrowUpRight } from 'lucide-react';
import { Badge, Icon, Button, ClickableRow } from '../../ui/index.js';
import { scoreColorClass } from '../../ui/constants.js';
import { formatEmv } from '../../../lib/formatEmv';
import type { Recommendation } from '../../../../shared/types/recommendations.js';

export const PRIORITY_ORDER: Recommendation['priority'][] = ['fix_now', 'fix_soon', 'fix_later', 'ongoing'];

export const PRIORITY_LABELS: Record<Recommendation['priority'], string> = {
  fix_now:  'Fix Now',
  fix_soon: 'Fix Soon',
  fix_later: 'Fix Later',
  ongoing:  'Ongoing',
};

export const PRIORITY_TONES: Record<Recommendation['priority'], 'red' | 'amber' | 'blue' | 'zinc'> = {
  fix_now:  'red',
  fix_soon: 'amber',
  fix_later: 'blue',
  ongoing:  'zinc',
};

export const STATUS_LABELS: Record<Recommendation['status'], string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  dismissed:   'Dismissed',
};

export const STATUS_TONES: Record<Recommendation['status'], 'zinc' | 'teal' | 'emerald' | 'blue'> = {
  pending:     'zinc',
  in_progress: 'teal',
  completed:   'emerald',
  dismissed:   'zinc',
};

/** OV breakdown bars — renders up to top 3 components by contribution. */
export function OvBreakdown({ rec }: { rec: Recommendation }) {
  if (!rec.opportunity || rec.opportunity.components.length === 0) return null;
  const top = [...rec.opportunity.components]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);
  const maxContrib = Math.max(...top.map(c => c.contribution), 0.0001);
  return (
    <div className="mt-2 pt-2 border-t border-[var(--brand-border)]/40 space-y-1.5">
      <div className="t-caption-sm text-[var(--brand-text-muted)]">OV breakdown</div>
      {top.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-16 flex-shrink-0">
            <span className="t-caption-sm font-medium text-[var(--brand-text)] capitalize">{c.dimension}</span>
          </div>
          <div className="flex-1 min-w-0 h-1.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] overflow-hidden">
            <div
              className="h-full rounded-[var(--radius-pill)] bg-blue-500"
              style={{ width: `${Math.max(6, Math.round((c.contribution / maxContrib) * 100))}%` }}
            />
          </div>
          <span className="t-caption-sm text-[var(--brand-text-muted)] truncate min-w-0 flex-1">{c.evidence}</span>
        </div>
      ))}
    </div>
  );
}

export interface RecommendationRowProps {
  rec: Recommendation;
  showUndismiss?: boolean;
  onUndismiss?: (recId: string) => void;
  /**
   * When provided, renders a "Fix" CTA in the header that calls back with the rec (without
   * toggling the row). Lets the Decision Queue inject deep-link routing while keeping this
   * component free of routing concerns. Omit it (e.g. WorkspaceHome) for an expand-only row.
   */
  onFixCta?: (rec: Recommendation) => void;
}

/** Single recommendation row card, expanded to show full OV detail. */
export function RecommendationRow({ rec, showUndismiss, onUndismiss, onFixCta }: RecommendationRowProps) {
  const [expanded, setExpanded] = useState(false);
  const ovScore = rec.opportunity?.value ?? rec.impactScore;

  return (
    <div className="rounded-[var(--radius-md)] bg-[var(--surface-3)] border border-[var(--brand-border)]/60">
      {/* Header row */}
      <div className="flex items-start">
        <ClickableRow
          onClick={() => setExpanded(e => !e)}
          className="flex min-w-0 flex-1 items-start gap-3 p-3"
          aria-expanded={expanded}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <Badge
                label={PRIORITY_LABELS[rec.priority]}
                tone={PRIORITY_TONES[rec.priority]}
                size="sm"
                shape="pill"
              />
              {rec.status !== 'dismissed' && (
                <Badge
                  label={STATUS_LABELS[rec.status]}
                  tone={STATUS_TONES[rec.status]}
                  size="sm"
                  variant="outline"
                  shape="pill"
                />
              )}
              {rec.opportunity && (
                <Badge
                  label={`OV ${Math.round(ovScore)}`}
                  tone="blue"
                  size="sm"
                  variant="outline"
                  shape="pill"
                />
              )}
              {rec.opportunity?.emvPerWeek != null && rec.opportunity.emvPerWeek > 0 && (
                <span className={`t-caption font-medium ${scoreColorClass(rec.impactScore)}`}>
                  {formatEmv(rec.opportunity.emvPerWeek)}
                </span>
              )}
            </div>
            <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{rec.title}</div>
            <div className="t-caption-sm text-[var(--brand-text-muted)] line-clamp-1 mt-0.5">{rec.insight}</div>
          </div>
          <Icon
            as={expanded ? ChevronDown : ChevronRight}
            size="sm"
            className="text-[var(--brand-text-muted)] flex-shrink-0 mt-0.5"
          />
        </ClickableRow>
        {onFixCta && (
          <div className="flex-shrink-0 p-3 pl-0">
            <Button
              size="sm"
              variant="primary"
              icon={ArrowUpRight}
              iconPosition="right"
              onClick={() => onFixCta(rec)}
            >
              Fix
            </Button>
          </div>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-[var(--brand-border)]/40 pt-2.5 space-y-2">
          {/* Description */}
          <p className="t-caption text-[var(--brand-text)]">{rec.description}</p>

          {/* Affected pages */}
          {rec.affectedPages.length > 0 && (
            <div>
              <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">
                Affected pages ({rec.affectedPages.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {rec.affectedPages.slice(0, 6).map(p => (
                  <span key={p} className="t-caption-sm text-[var(--brand-text)] bg-[var(--surface-1)] border border-[var(--brand-border)] rounded px-1.5 py-0.5 truncate max-w-[200px]">{p}</span>
                ))}
                {rec.affectedPages.length > 6 && (
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">+{rec.affectedPages.length - 6} more</span>
                )}
              </div>
            </div>
          )}

          {/* Traffic metrics */}
          {(rec.trafficAtRisk > 0 || rec.impressionsAtRisk > 0) && (
            <div className="flex gap-4">
              {rec.trafficAtRisk > 0 && (
                <div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">Traffic at risk</div>
                  <div className="t-ui font-medium text-blue-400">{rec.trafficAtRisk.toLocaleString()} clicks</div>
                </div>
              )}
              {rec.impressionsAtRisk > 0 && (
                <div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">Impressions at risk</div>
                  <div className="t-ui font-medium text-blue-400">{rec.impressionsAtRisk.toLocaleString()}</div>
                </div>
              )}
            </div>
          )}

          {/* Full OV breakdown */}
          <OvBreakdown rec={rec} />

          {/* Admin-only: estimated gain + EMV detail */}
          <div className="flex items-start gap-4 pt-0.5">
            {rec.estimatedGain && (
              <div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Estimated gain</div>
                <div className="t-caption text-[var(--brand-text-bright)]">{rec.estimatedGain}</div>
              </div>
            )}
            {rec.opportunity?.emvPerWeek != null && rec.opportunity.emvPerWeek > 0 && (
              <div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">EMV/wk (admin)</div>
                <div className={`t-caption font-medium ${scoreColorClass(rec.impactScore)}`}>
                  {formatEmv(rec.opportunity.emvPerWeek)}
                </div>
              </div>
            )}
            {rec.opportunity?.confidence != null && (
              <div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Confidence</div>
                <div className="t-caption text-[var(--brand-text)]">{Math.round(rec.opportunity.confidence * 100)}%</div>
              </div>
            )}
          </div>

          {/* Un-dismiss action */}
          {showUndismiss && onUndismiss && (
            <div className="pt-1">
              <Button
                size="sm"
                variant="secondary"
                icon={RotateCcw}
                iconPosition="left"
                onClick={(e) => { e.stopPropagation(); onUndismiss(rec.id); }}
              >
                Un-dismiss
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
