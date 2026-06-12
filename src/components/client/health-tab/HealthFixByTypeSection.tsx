/**
 * HealthFixByTypeSection — the "By Fix Type" view in the all-pages section.
 *
 * Extracted from HealthTabSections.tsx (was the IIFE inside
 * `HealthAllPagesSection` viewMode === 'by-fix-type'). Extraction keeps the
 * god component from growing with purchase-surface logic.
 *
 * Adds per-row:
 * - "Fix this — $X" teal CTA via FixableIssueRow (Growth/Free)
 * - "Covered by hours — request fix" via FixableIssueRow (Premium)
 * - Impact line via HealthImpactLine (when impactBand present on rec)
 */
import { ChevronDown } from 'lucide-react';
import { Badge, ClickableRow } from '../../ui';
import { SEV, type AuditDetail } from '../types';
import { toLiveUrl } from '../utils';
import { buildFixTypeGroups, checkImpact } from './healthTabModel';
import { FixableIssueRow } from './FixableIssueRow';
import { HealthImpactLine } from './HealthImpactLine';
import type { HealthTabShell } from './useHealthTabShell';
import type { Tier } from '../../ui/TierGate';
import type { ImpactBand } from '../../../../shared/types/fix-catalog.js';

interface HealthFixByTypeSectionProps {
  auditDetail: AuditDetail;
  liveDomain?: string;
  shell: Pick<HealthTabShell, 'severityFilter' | 'showInfoItems' | 'expandedPages' | 'togglePage'>;
  tier: Tier;
  /** External-billing workspaces: render request-fix framing, never prices/cart. */
  hidePrices?: boolean;
  /**
   * Impact bands keyed by audit check type (e.g. "title", "structured-data").
   * Passed down from the parent — computed from the client intelligence projection.
   * Absent keys → no impact line for that check.
   */
  impactBandsByCheck?: Record<string, ImpactBand>;
  onRequestFix?: (check: string, label: string) => void;
}

export function HealthFixByTypeSection({
  auditDetail,
  liveDomain,
  shell,
  tier,
  hidePrices,
  impactBandsByCheck,
  onRequestFix,
}: HealthFixByTypeSectionProps) {
  const groups = buildFixTypeGroups(auditDetail, shell.severityFilter, shell.showInfoItems);

  if (groups.length === 0) {
    return (
      <div className="px-4 py-8 text-center t-caption text-[var(--brand-text-muted)]">
        No issues match your filters
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--brand-border)]/50 max-h-[500px] overflow-y-auto">
      {groups.map((group) => {
        const sc = SEV[group.severity];
        const key = `fix-type-${group.check}`;
        const isExpanded = shell.expandedPages.has(key);
        const impactBand = impactBandsByCheck?.[group.check];

        return (
          <div key={group.check} className={`transition-all ${isExpanded ? 'bg-[var(--surface-1)]/50' : ''}`}>
            <ClickableRow
              onClick={() => shell.togglePage(key)}
              className="flex items-center gap-3 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="t-caption font-medium text-[var(--brand-text)]">{group.label}</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">
                  {group.pages.length} {group.pages.length === 1 ? 'page' : 'pages'} affected
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`t-caption-sm font-medium uppercase ${sc.text}`}>{group.severity}</span>
                <Badge
                  label={String(group.pages.length)}
                  tone={group.severity === 'error' ? 'red' : group.severity === 'warning' ? 'amber' : 'blue'}
                  variant="outline"
                />
                <ChevronDown
                  className={`w-3.5 h-3.5 text-[var(--brand-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                />
              </div>
            </ClickableRow>

            {isExpanded && (
              <div className="px-4 pb-3">
                {checkImpact(group.check) && (
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2 leading-relaxed px-1">
                    {checkImpact(group.check)}
                  </div>
                )}

                {/* Impact estimate line */}
                {impactBand && (
                  <div className="mb-2 px-1">
                    <HealthImpactLine impactBand={impactBand} />
                  </div>
                )}

                {/* Purchase CTA */}
                <div className="mb-3 px-1">
                  <FixableIssueRow
                    check={group.check}
                    displayName={group.label}
                    pageIds={group.pages.map((p) => p.pageId)}
                    tier={tier}
                    hidePrices={hidePrices}
                    onRequestFix={() => onRequestFix?.(group.check, group.label)}
                  />
                </div>

                <div className="space-y-1.5">
                  {group.pages.map((page, i) => (
                    <div
                      key={`${page.pageId}-${i}`}
                      className={`px-3 py-2 rounded-[var(--radius-lg)] ${sc.bg} border ${sc.border}`}
                    >
                      <div className="t-caption-sm font-medium text-[var(--brand-text)] truncate">{page.page}</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">
                        {toLiveUrl(page.url, liveDomain)}
                      </div>
                      {page.recommendation && (
                        <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                          {page.recommendation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
