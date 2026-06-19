/**
 * DecayingPagesCard — Act band surface for pages losing search traffic (content_decay).
 *
 * Reads the cached decay analysis (useContentDecay) and shows the most severe decaying pages with
 * one-click Refresh-brief / Review-page CTAs. Renders nothing when no analysis has run or no pages
 * are decaying (the endpoint is cache-only and returns null on first run). Admin Strategy page.
 *
 * P3 Lane C — adds a "Send to client" button per row that routes through the rec-lifecycle
 * API wrapper (recommendations.send). The button calls sendRecommendation for the page's
 * content_refresh rec. That rec is minted by `generateRecommendations` (server/recommendations.ts),
 * fired best-effort via the delayed post-update regen (~30s latency window) — NOT by a Lane A
 * reconciler. The "Send to client" button only renders once that regen has produced the rec.
 *
 * After send: a muted-teal "Sent" pill + disabled state. Client response is rendered inline:
 *   approved  → emerald "Client approved"
 *   declined  → red "Client declined"
 *   discussing → amber "Discussing"
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, FileText, ArrowUpRight, Send } from 'lucide-react';
import { Badge, Button, Icon, SectionCard, type BadgeTone } from '../ui';
import { adminPath } from '../../routes';
import { useContentDecay } from '../../hooks/admin/useContentDecay';
import { useAdminRecommendationSet } from '../../hooks/admin/useAdminRecommendations';
import { recommendations } from '../../api/misc';
import { queryKeys } from '../../lib/queryKeys';
import { WhyHowResult, isSendable } from './shared/WhyHowResult';
import { toPageSlug } from '../../../shared/page-address-utils';
import type { DecayingPagesCardProps } from './types';
import type { Recommendation } from '../../../shared/types/recommendations';

const SEVERITY_RANK: Record<'critical' | 'warning' | 'watch', number> = { critical: 0, warning: 1, watch: 2 };
const SEVERITY_TONE: Record<'critical' | 'warning' | 'watch', BadgeTone> = { critical: 'red', warning: 'amber', watch: 'blue' };

/** Map clientStatus → display label + tone for the inline feedback pill. */
const CLIENT_STATUS_DISPLAY: Record<string, { label: string; tone: BadgeTone }> = {
  approved: { label: 'Client approved', tone: 'emerald' },
  declined: { label: 'Client declined', tone: 'red' },
  discussing: { label: 'Discussing', tone: 'amber' },
};

export function DecayingPagesCard({ workspaceId }: DecayingPagesCardProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useContentDecay(workspaceId);
  const { data: recSet } = useAdminRecommendationSet(workspaceId);

  // Track optimistic "sent" state per page path so the UI updates immediately after send.
  const [sentPages, setSentPages] = useState<Set<string>>(new Set());

  const pages = data?.decayingPages ?? [];
  if (pages.length === 0) return null;

  const top = [...pages]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.clickDeclinePct ?? 0) - (a.clickDeclinePct ?? 0))
    .slice(0, 5);

  const go = (tab: 'content-pipeline' | 'page-intelligence', page: string) =>
    navigate(adminPath(workspaceId, tab), { state: { fixContext: { targetRoute: tab, pageSlug: page, pageName: page } } });

  /**
   * Find the content_refresh rec for a given page path.
   *
   * The rec is minted best-effort by `generateRecommendations` (fired via the delayed
   * post-update regen, ~30s after the decay analysis writes) — NOT synchronously, so a
   * freshly-decayed page has no sendable rec until that regen lands.
   *
   * The generator stores `affectedPages: [toPageSlug(dp.page)]` (no leading slash) while the
   * decay page keeps its leading slash, so a raw `includes()` never matches. Normalize BOTH
   * sides through the shared `toPageSlug` so the leading-slash drift can't break the match.
   */
  function findContentRefreshRec(pagePath: string): Recommendation | undefined {
    const target = toPageSlug(pagePath);
    return recSet?.recommendations.find(
      r => r.type === 'content_refresh' && r.affectedPages.some(p => toPageSlug(p) === target)
    );
  }

  return (
    <SectionCard title="Decaying pages" titleIcon={<Icon as={AlertTriangle} size="md" className="text-red-400" />}>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">Published pages losing search traffic — refresh them before rankings slip further.</p>
      <div className="space-y-2">
        {top.map(page => (
          <PageRow
            key={page.page}
            workspaceId={workspaceId}
            page={page}
            severityTone={SEVERITY_TONE[page.severity]}
            rec={findContentRefreshRec(page.page)}
            alreadySent={sentPages.has(page.page)}
            onSent={() => setSentPages(prev => new Set([...prev, page.page]))}
            onNavigate={go}
            queryClient={qc}
          />
        ))}
      </div>
    </SectionCard>
  );
}

// ── Per-row component (isolates mutation state) ───────────────────

interface PageRowProps {
  workspaceId: string;
  page: { page: string; title?: string; previousClicks: number; currentClicks: number; clickDeclinePct: number; severity: 'critical' | 'warning' | 'watch' };
  severityTone: BadgeTone;
  rec: Recommendation | undefined;
  alreadySent: boolean;
  onSent: () => void;
  onNavigate: (tab: 'content-pipeline' | 'page-intelligence', page: string) => void;
  queryClient: ReturnType<typeof useQueryClient>;
}

function PageRow({ workspaceId, page, severityTone, rec, alreadySent, onSent, onNavigate, queryClient }: PageRowProps) {
  const sendMutation = useMutation<Recommendation, Error, string>({
    mutationFn: (recId) => recommendations.send(workspaceId, recId), // strategy-send-must-route-through-lifecycle-ok: DecayingPagesCard — routes through rec lifecycle send()
    onSuccess: () => {
      onSent();
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
    },
  });

  const isSent = alreadySent || rec?.clientStatus === 'sent';
  const clientFeedback = rec?.clientStatus ? CLIENT_STATUS_DISPLAY[rec.clientStatus] : undefined;
  // Show feedback badge when client has responded (not just 'sent' — sent is the Sent pill state)
  const showFeedback = clientFeedback && rec?.clientStatus !== 'sent';

  // Send button is available only when a rec exists, has not been sent yet, AND passes the isSendable gate
  const canSend = !!rec && !isSent && !sendMutation.isPending && isSendable({ insight: rec.insight, description: rec.description, estimatedGain: rec.estimatedGain, impactBand: rec.impactBand });

  return (
    <div className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]">
      <div className="flex items-center justify-between gap-2">
        <span className="t-mono text-[var(--brand-text-bright)] truncate">{page.title || page.page}</span>
        <Badge tone={severityTone} size="sm" label={page.severity} className="capitalize flex-shrink-0" />
      </div>
      {/* WhyHowResult — compact Why line from the content_refresh rec (renders null when no insight) */}
      {rec && (
        <WhyHowResult
          insight={rec.insight}
          estimatedGain={rec.estimatedGain}
          impactBand={rec.impactBand}
          className="mt-1"
        />
      )}
      <div className="flex items-end justify-between gap-3 mt-1">
        <div className="t-caption-sm text-[var(--brand-text-muted)]">
          {page.previousClicks.toLocaleString()} → {page.currentClicks.toLocaleString()} clicks
          <span className="text-red-400 ml-1">({Math.round(page.clickDeclinePct)}% drop)</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          {/* Send to client — routes through rec lifecycle (strategy-send-must-route-through-lifecycle) */}
          {rec && (
            isSent ? (
              // Muted-teal "Sent" badge — shown after send or when clientStatus is 'sent'
              <Badge
                tone="teal"
                size="sm"
                icon={Send}
                label="Sent"
                variant="outline"
                className="opacity-70"
              />
            ) : (
              // Teal send button — Four Laws: teal for actions
              <Button
                onClick={() => canSend && rec && sendMutation.mutate(rec.id)}
                disabled={!canSend}
                variant="ghost"
                size="sm"
                className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 disabled:opacity-50"
              >
                <Icon as={Send} size="sm" className="text-teal-300" />
                Send to client
              </Button>
            )
          )}

          {/* Client response inline feedback */}
          {showFeedback && (
            <Badge tone={clientFeedback.tone} size="sm" label={clientFeedback.label} />
          )}

          {/* Send error */}
          {sendMutation.isError && (
            <span className="t-caption-sm text-red-400">
              {sendMutation.error instanceof Error ? sendMutation.error.message : 'Send failed'}
            </span>
          )}

          <Button
            onClick={() => onNavigate('content-pipeline', page.page)}
            variant="ghost"
            size="sm"
            className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40"
          >
            <Icon as={FileText} size="sm" className="text-teal-300" /> Refresh brief
          </Button>
          <Button
            onClick={() => onNavigate('page-intelligence', page.page)}
            variant="ghost"
            size="sm"
            className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)] t-caption-sm text-[var(--brand-text)] font-medium hover:bg-[var(--surface-3)]"
          >
            <Icon as={ArrowUpRight} size="sm" /> Review page
          </Button>
        </div>
      </div>
    </div>
  );
}
