/**
 * CannibalizationTriage — the Act band's actionable replacement for the passive CannibalizationAlert.
 *
 * Each keyword-cannibalization issue shows the competing pages with the KEEPER marked (canonical, or
 * best-position) and every DUPLICATE carrying a "Fix in editor" CTA that opens the SEO Editor focused
 * on that page (via fixContext.pageSlug — the editor's prefill effect matches by normalized path).
 * Read-only/navigation only; Mark-resolved + Send-to-client are Phase 3b. Admin Strategy page.
 * The shared CannibalizationAlert is left untouched (still used by the legacy layout + ContentPipeline).
 */
import { useNavigate } from 'react-router-dom';
import { Copy, AlertTriangle, ArrowUpRight, Check, CheckCircle2 } from 'lucide-react';
import { Badge, Button, Icon, SectionCard, type BadgeTone } from '../ui';
import { adminPath } from '../../routes';
import { matchPageIdentity } from '../../../shared/page-address-utils';
import { useOutcomeActions, useRecordOutcomeAction } from '../../hooks/admin/useOutcomes';
import { cannibalizationSourceId } from '../../lib/cannibalizationSourceId';
import type { CannibalizationItem } from '../../../shared/types/workspace';
import type { CannibalizationTriageProps } from './types';

const SEV_TONE: Record<CannibalizationItem['severity'], BadgeTone> = { high: 'red', medium: 'amber', low: 'zinc' };

const ACTION_LABEL: Record<NonNullable<CannibalizationItem['action']>, string> = {
  canonical_tag: 'Canonical tag',
  redirect_301: '301 redirect',
  differentiate: 'Differentiate',
  noindex: 'Noindex',
};

/**
 * The page to keep: the canonical page when it's set AND is one of the competing pages; otherwise
 * the best-ranking page. Ranking tiebreak mirrors the server's canonical derivation
 * (server/keyword-strategy-enrichment.ts): lowest position, then most clicks, then most impressions.
 */
function keeperPathOf(item: CannibalizationItem): string | undefined {
  if (item.canonicalPath && item.pages.some(p => matchPageIdentity(p.path, item.canonicalPath!))) {
    return item.canonicalPath;
  }
  const ranked = [...item.pages]
    .filter(p => p.position != null)
    .sort((a, b) =>
      (a.position! - b.position!) ||
      ((b.clicks ?? 0) - (a.clicks ?? 0)) ||
      ((b.impressions ?? 0) - (a.impressions ?? 0)));
  return (ranked[0] ?? item.pages[0])?.path;
}

export function CannibalizationTriage({ entries, workspaceId }: CannibalizationTriageProps) {
  const navigate = useNavigate();
  const { data: resolvedActions } = useOutcomeActions(workspaceId, 'cannibalization_resolved');
  const resolveMutation = useRecordOutcomeAction(workspaceId);

  // Resolution is inferred from durable tracked_actions (the cannibalization_issues row is
  // delete-then-reinsert on regen, so it can't hold the flag). Filter to OUR source type so
  // recommendation-sourced cannibalization_resolved actions don't collide. Resolved issues drop out
  // of the queue (mirrors DecisionQueue's server-backed status filter — no local optimistic toggles).
  const resolvedKeys = new Set(
    (resolvedActions ?? [])
      .filter(a => a.sourceType === 'cannibalization')
      .map(a => a.sourceId)
      .filter((id): id is string => id != null),
  );
  const visible = (entries ?? []).filter(e => !resolvedKeys.has(cannibalizationSourceId(e.keyword)));
  if (visible.length === 0) return null;

  const highCount = visible.filter(e => e.severity === 'high').length;

  const fixInEditor = (path: string) =>
    navigate(adminPath(workspaceId, 'seo-editor'), {
      state: { fixContext: { targetRoute: 'seo-editor', pageSlug: path, pageName: path } },
    });

  const markResolved = (item: CannibalizationItem, keeperPath: string | undefined) => {
    const keeper = keeperPath ? item.pages.find(p => matchPageIdentity(p.path, keeperPath)) : undefined;
    resolveMutation.mutate({
      actionType: 'cannibalization_resolved',
      sourceType: 'cannibalization',
      sourceId: cannibalizationSourceId(item.keyword),
      targetKeyword: item.keyword,
      pageUrl: keeperPath,
      baselineSnapshot: {
        ...(keeper?.position != null ? { position: keeper.position } : {}),
        ...(keeper?.clicks != null ? { clicks: keeper.clicks } : {}),
        ...(keeper?.impressions != null ? { impressions: keeper.impressions } : {}),
      },
    });
  };

  return (
    <SectionCard
      title="Keyword cannibalization"
      titleIcon={<Icon as={Copy} size="md" className="text-accent-danger" />}
      titleExtra={highCount > 0 ? <Badge tone="red" size="sm" label={`${highCount} critical`} /> : undefined}
    >
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
        Multiple pages competing for the same keyword dilute ranking power. Keep one page and fix or consolidate the duplicates.
      </p>
      <div className="space-y-2">
        {visible.map((item, i) => {
          const keeperPath = keeperPathOf(item);
          return (
            <div key={`${item.keyword}-${i}`} className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon as={AlertTriangle} size="sm" className={item.severity === 'high' ? 'text-accent-danger' : item.severity === 'medium' ? 'text-accent-warning' : 'text-[var(--brand-text-muted)]'} />
                  <span className="t-body font-medium text-[var(--brand-text-bright)] truncate">&ldquo;{item.keyword}&rdquo;</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge tone={SEV_TONE[item.severity]} size="sm" label={item.severity} />
                  {item.action && <span className="t-caption-sm text-[var(--brand-text-muted)]">{ACTION_LABEL[item.action]}</span>}
                  <Button
                    onClick={() => markResolved(item, keeperPath)}
                    disabled={resolveMutation.isPending}
                    variant="ghost"
                    size="sm"
                    className="gap-1 px-2 py-1 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)] t-caption-sm text-[var(--brand-text)] font-medium hover:bg-[var(--surface-3)]"
                  >
                    <Icon as={CheckCircle2} size="sm" className="text-emerald-400" /> {resolveMutation.isPending ? 'Resolving…' : 'Mark resolved'}
                  </Button>
                </div>
              </div>

              {item.recommendation && (
                <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">{item.recommendation}</p>
              )}

              <div className="mt-2 space-y-1">
                {item.pages.map((page, pi) => {
                  const isKeeper = keeperPath ? matchPageIdentity(page.path, keeperPath) : pi === 0;
                  return (
                    <div key={`${page.path}-${pi}`} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="t-mono text-[var(--brand-text)] truncate">{page.path}</span>
                        {page.position != null && <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">#{Math.round(page.position)}</span>}
                        {page.impressions != null && page.impressions > 0 && <span className="t-caption-sm text-blue-400 flex-shrink-0">{page.impressions.toLocaleString()} imp</span>}
                      </div>
                      {isKeeper ? (
                        <span className="flex items-center gap-1 t-caption-sm text-emerald-400 flex-shrink-0">
                          <Icon as={Check} size="sm" className="text-emerald-400" /> Keep
                        </span>
                      ) : (
                        <Button
                          onClick={() => fixInEditor(page.path)}
                          variant="ghost"
                          size="sm"
                          className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 flex-shrink-0"
                        >
                          <Icon as={ArrowUpRight} size="sm" className="text-teal-300" /> Fix in editor
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
