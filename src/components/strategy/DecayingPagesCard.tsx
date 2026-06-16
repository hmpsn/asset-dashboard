/**
 * DecayingPagesCard — Act band surface for pages losing search traffic (content_decay).
 *
 * Reads the cached decay analysis (useContentDecay) and shows the most severe decaying pages with
 * one-click Refresh-brief / Review-page CTAs. Renders nothing when no analysis has run or no pages
 * are decaying (the endpoint is cache-only and returns null on first run). Admin Strategy page.
 */
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, FileText, ArrowUpRight } from 'lucide-react';
import { Badge, Button, Icon, SectionCard, type BadgeTone } from '../ui';
import { adminPath } from '../../routes';
import { useContentDecay } from '../../hooks/admin/useContentDecay';
import type { DecayingPagesCardProps } from './types';

const SEVERITY_RANK: Record<'critical' | 'warning' | 'watch', number> = { critical: 0, warning: 1, watch: 2 };
const SEVERITY_TONE: Record<'critical' | 'warning' | 'watch', BadgeTone> = { critical: 'red', warning: 'amber', watch: 'blue' };

export function DecayingPagesCard({ workspaceId }: DecayingPagesCardProps) {
  const navigate = useNavigate();
  const { data } = useContentDecay(workspaceId);

  const pages = data?.decayingPages ?? [];
  if (pages.length === 0) return null;

  const top = [...pages]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.clickDeclinePct ?? 0) - (a.clickDeclinePct ?? 0))
    .slice(0, 5);

  const go = (tab: 'content-pipeline' | 'page-intelligence', page: string) =>
    navigate(adminPath(workspaceId, tab), { state: { fixContext: { targetRoute: tab, pageSlug: page, pageName: page } } });

  return (
    <SectionCard title="Decaying pages" titleIcon={<Icon as={AlertTriangle} size="md" className="text-red-400" />}>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">Published pages losing search traffic — refresh them before rankings slip further.</p>
      <div className="space-y-2">
        {top.map(page => (
          <div key={page.page} className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]">
            <div className="flex items-center justify-between gap-2">
              <span className="t-mono text-[var(--brand-text-bright)] truncate">{page.title || page.page}</span>
              <Badge tone={SEVERITY_TONE[page.severity]} size="sm" label={page.severity} className="capitalize flex-shrink-0" />
            </div>
            <div className="flex items-end justify-between gap-3 mt-1">
              <div className="t-caption-sm text-[var(--brand-text-muted)]">
                {page.previousClicks.toLocaleString()} → {page.currentClicks.toLocaleString()} clicks
                <span className="text-red-400 ml-1">({Math.round(page.clickDeclinePct)}% drop)</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Button
                  onClick={() => go('content-pipeline', page.page)}
                  variant="ghost"
                  size="sm"
                  className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40"
                >
                  <Icon as={FileText} size="sm" className="text-teal-300" /> Refresh brief
                </Button>
                <Button
                  onClick={() => go('page-intelligence', page.page)}
                  variant="ghost"
                  size="sm"
                  className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)] t-caption-sm text-[var(--brand-text)] font-medium hover:bg-[var(--surface-3)]"
                >
                  <Icon as={ArrowUpRight} size="sm" /> Review page
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
