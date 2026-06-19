import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import { Button, ClickableRow, SectionCard, StatCard, Icon, Badge } from '../ui';
import type { BadgeTone } from '../ui';
import {
  Loader2, TrendingUp, Globe, Search, Link2,
  DollarSign, Target, ChevronDown, ChevronRight, Send,
} from 'lucide-react';
import { fmtNum } from '../../utils/formatNumbers';
import { recommendations } from '../../api/misc';
import { useAdminRecommendationSet } from '../../hooks/admin/useAdminRecommendations';
import { WhyHowResult, isSendable } from './shared/WhyHowResult';
import type { Recommendation } from '../../../shared/types/recommendations';

interface DomainOverview {
  domain: string;
  organicKeywords: number;
  organicTraffic: number;
  organicCost: number;
  paidKeywords: number;
  paidTraffic: number;
  paidCost: number;
}

interface BacklinksOverview {
  totalBacklinks: number;
  referringDomains: number;
}

interface DomainKeyword {
  keyword: string;
  position: number;
  volume: number;
  difficulty: number;
  url: string;
  traffic: number;
}

interface KeywordGap {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorPosition: number;
  competitorDomain: string;
}

interface DomainData {
  domain: string;
  isOwn: boolean;
  overview: DomainOverview | null;
  backlinks: BacklinksOverview | null;
  topKeywords: DomainKeyword[];
}

interface IntelResponse {
  domains: DomainData[];
  keywordGaps: KeywordGap[];
  fetchedAt: string;
  degraded?: boolean;
  providerFailures?: Array<{ area: string; provider: string; domain?: string }>;
}

interface Props {
  workspaceId: string;
  competitors: string[];
  seoDataAvailable: boolean;
  /** Keyword gaps from the stored strategy — used as fallback when the live API call fails or returns empty */
  cachedKeywordGaps?: KeywordGap[];
  /**
   * 'full' (default) = the standalone Competitive Intel card (legacy layout, byte-identical).
   * 'merged' = embedded inside the Reference-band Authority & Backlinks leaf (Phase 4): hides the
   * own-domain stat grid (duplicates the backlink stats) and the Keyword Gaps section (deduped to the
   * standalone CompetitorEvidence surface), and uses the corrected cache freshness label.
   */
  variant?: 'full' | 'merged';
  /**
   * When true (strategy-command-center ON) the per-gap "Send to client" button is rendered.
   * Flag-OFF: button never appears — byte-identical to the legacy layout.
   */
  commandCenterEnabled?: boolean;
  /**
   * When true (strategy-competitor-send ON) the send button is active. Requires commandCenterEnabled
   * to also be true — the send path is doubly gated per the feature-flag composition rule.
   */
  competitorSendEnabled?: boolean;
}

function difficultyColor(kd: number): string {
  if (kd < 30) return 'text-emerald-400';
  if (kd < 60) return 'text-amber-400';
  return 'text-red-400';
}

function ComparisonBar({ myVal, theirVal, label }: { myVal: number; theirVal: number; label: string }) {
  const total = myVal + theirVal || 1;
  const myPct = Math.round((myVal / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between t-caption-sm">
        <span className="text-teal-400 font-medium">{fmtNum(myVal)}</span>
        <span className="text-[var(--brand-text-muted)]">{label}</span>
        <span className="text-orange-400 font-medium">{fmtNum(theirVal)}</span>
      </div>
      <div className="h-2 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden flex">
        <div className="h-full bg-teal-500/70 rounded-l-[var(--radius-pill)] transition-all" style={{ width: `${myPct}%` }} />
        <div className="h-full bg-orange-500/70 rounded-r-[var(--radius-pill)] transition-all" style={{ width: `${100 - myPct}%` }} />
      </div>
    </div>
  );
}

/** Map clientStatus → display label + tone for the inline feedback pill (mirrors DecayingPagesCard). */
const CLIENT_STATUS_DISPLAY: Record<string, { label: string; tone: BadgeTone }> = {
  approved: { label: 'Client approved', tone: 'emerald' },
  declined: { label: 'Client declined', tone: 'red' },
  discussing: { label: 'Discussing', tone: 'amber' },
};

// ── Per-gap row (isolates mutation state) ─────────────────────────

interface GapRowProps {
  gap: KeywordGap;
  workspaceId: string;
  rec: Recommendation | undefined;
  alreadySent: boolean;
  onSent: () => void;
  showSend: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
}

function GapRow({ gap, workspaceId, rec, alreadySent, onSent, showSend, queryClient }: GapRowProps) {
  // Mint→send in one mutation. The competitor rec does NOT pre-exist until first send —
  // findCompetitorRec only finds, nothing else mints one — so the click must mint it
  // (idempotent on targetKeyword) and then route the minted rec through the lifecycle send().
  // When a rec already exists (re-render after mint, or returned by the idempotent endpoint)
  // the mint step is skipped and we send the existing rec id directly.
  const sendMutation = useMutation<Recommendation, Error, void>({
    mutationFn: async () => {
      const minted = rec ?? await recommendations.mintCompetitor(workspaceId, {
        keyword: gap.keyword,
        competitorDomain: gap.competitorDomain,
      });
      return recommendations.send(workspaceId, minted.id); // strategy-send-must-route-through-lifecycle-ok: CompetitiveIntel — routes through rec lifecycle send()
    },
    onSuccess: () => {
      onSent();
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
    },
  });

  const isSent = alreadySent || rec?.clientStatus === 'sent';
  const clientFeedback = rec?.clientStatus ? CLIENT_STATUS_DISPLAY[rec.clientStatus] : undefined;
  const showFeedback = clientFeedback && rec?.clientStatus !== 'sent';
  // Enabled whenever the gap is sendable — NOT only when a rec pre-exists. When a rec already
  // exists we honor its sendable gate; otherwise the gap itself is always mintable into a
  // sendable competitor rec (the mint guarantees insight + estimatedGain), so the gap keyword
  // being present is sufficient.
  const recSendable = rec
    ? isSendable({ insight: rec.insight, description: rec.description, estimatedGain: rec.estimatedGain, impactBand: rec.impactBand })
    : !!gap.keyword;
  const canSend = !isSent && !sendMutation.isPending && recSendable;

  // Flag-OFF: render the byte-identical legacy gap row (single flex div, no wrapper, no send
  // affordance). This is the exact pre-feature markup — the doubly-gated send UI below only ever
  // mounts when both strategy-command-center && strategy-competitor-send are ON (showSend).
  if (!showSend) {
    return (
      <div className="flex items-center gap-2 t-caption px-2 py-1.5 bg-[var(--surface-1)]/50 rounded-[var(--radius-lg)]">
        <span className="flex-1 text-[var(--brand-text-bright)] truncate">{gap.keyword}</span>
        <span className="text-[var(--brand-text-muted)] font-mono">{fmtNum(gap.volume)}/mo</span>
        <span className={`font-mono ${difficultyColor(gap.difficulty)}`}>KD {gap.difficulty}%</span>
        <span className="text-orange-400/80 t-caption-sm">{gap.competitorDomain} #{gap.competitorPosition}</span>
      </div>
    );
  }

  return (
    <div className="px-2 py-1.5 bg-[var(--surface-1)]/50 rounded-[var(--radius-lg)] space-y-1">
      <div className="flex items-center gap-2 t-caption">
        <span className="flex-1 text-[var(--brand-text-bright)] truncate">{gap.keyword}</span>
        <span className="text-[var(--brand-text-muted)] font-mono">{fmtNum(gap.volume)}/mo</span>
        <span className={`font-mono ${difficultyColor(gap.difficulty)}`}>KD {gap.difficulty}%</span>
        <span className="text-orange-400/80 t-caption-sm">{gap.competitorDomain} #{gap.competitorPosition}</span>
        {/* strategy-competitor-send: "Send to client" button — doubly gated by
            commandCenterEnabled && competitorSendEnabled (checked by showSend) */}
        {showSend && (
          isSent ? (
            <Badge tone="teal" size="sm" icon={Send} label="Sent" variant="outline" className="opacity-70 flex-shrink-0" />
          ) : (
            <Button
              onClick={() => canSend && sendMutation.mutate()}
              disabled={!canSend}
              variant="ghost"
              size="sm"
              className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 disabled:opacity-50 flex-shrink-0"
            >
              <Icon as={Send} size="sm" className="text-teal-300" />
              Send to client
            </Button>
          )
        )}
      </div>
      {/* WhyHowResult compact Why-line — renders when the rec has insight data */}
      {showSend && rec && (
        <WhyHowResult
          insight={rec.insight}
          estimatedGain={rec.estimatedGain}
          impactBand={rec.impactBand}
          className="pl-0"
        />
      )}
      {/* Client response inline feedback */}
      {showSend && showFeedback && clientFeedback && (
        <Badge tone={clientFeedback.tone} size="sm" label={clientFeedback.label} />
      )}
      {/* Send error */}
      {showSend && sendMutation.isError && (
        <span className="t-caption-sm text-red-400">
          {sendMutation.error instanceof Error ? sendMutation.error.message : 'Send failed'}
        </span>
      )}
    </div>
  );
}

export function CompetitiveIntel({ workspaceId, competitors, seoDataAvailable, cachedKeywordGaps, variant = 'full', commandCenterEnabled = false, competitorSendEnabled = false }: Props) {
  const merged = variant === 'merged';
  const [expanded, toggleExpand] = useToggleSet<string>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const queryClient = useQueryClient();
  const competitorKey = competitors.join(',');
  // strategy-competitor-send: load the rec set so we can find / display competitor recs per gap.
  // Enabled only when both flags are ON — saves the network call when the feature is dark.
  const showSend = commandCenterEnabled && competitorSendEnabled;
  const { data: recSet } = useAdminRecommendationSet(showSend ? workspaceId : undefined, { enabled: showSend });
  // Track optimistic "sent" state per keyword gap so the UI updates immediately after send.
  const [sentGaps, setSentGaps] = useState<Set<string>>(new Set());

  const { data, isLoading, error, refetch } = useQuery<IntelResponse>({
    queryKey: queryKeys.admin.competitorIntel(workspaceId, competitorKey),
    queryFn: () => get<IntelResponse>(`/api/seo/competitive-intel/${workspaceId}?competitors=${encodeURIComponent(competitorKey)}`),
    enabled: competitors.length > 0 && seoDataAvailable,
    // Merged (Reference-band) view uses a 168h staleTime — comfortably within the underlying
    // DataForSEO provider caches (overview/backlinks 168h, competitors 336h), so the old 48h just
    // forced needless refetches of provider-cached data. Legacy 'full' keeps 48h (flag-off unchanged).
    staleTime: (merged ? 168 : 48) * 60 * 60 * 1000,
    retry: 1,
  });

  const errorMsg = error instanceof Error ? error.message : error ? String(error) : null;

  if (!seoDataAvailable) {
    return (
      <SectionCard>
        <div className="flex items-center gap-3 py-6 justify-center">
          <Icon as={Target} size="lg" className="text-[var(--brand-text-muted)]" />
          <div>
            <p className="t-body text-[var(--brand-text)]">Competitive Intelligence requires DataForSEO</p>
            <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">Configure DataForSEO to unlock live domain, keyword, and backlink comparisons.</p>
          </div>
        </div>
      </SectionCard>
    );
  }

  if (!competitors.length) {
    return (
      <SectionCard>
        <div className="flex items-center gap-3 py-6 justify-center">
          <Icon as={Globe} size="lg" className="text-[var(--brand-text-muted)]" />
          <div>
            <p className="t-body text-[var(--brand-text)]">Add competitor domains above</p>
            <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">Enter competitors in Strategy Settings → Competitor Domains, then generate a strategy.</p>
          </div>
        </div>
      </SectionCard>
    );
  }

  if (isLoading) {
    return (
      <SectionCard>
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <Icon as={Loader2} size="lg" className="animate-spin text-teal-400" />
          <p className="t-body text-[var(--brand-text)]">Fetching competitive intelligence...</p>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">Comparing domain metrics, keywords, and backlinks</p>
        </div>
      </SectionCard>
    );
  }

  // When the live API errors or returns no data, fall back to cached keyword gaps from the strategy blob
  const effectiveGaps = (data?.keywordGaps?.length ? data.keywordGaps : cachedKeywordGaps) ?? [];
  const usingFallbackGaps = effectiveGaps.length > 0 && !data?.keywordGaps?.length && !!cachedKeywordGaps?.length;

  // ── Competitor send helpers (strategy-competitor-send) ─────────
  /**
   * Find the `competitor` rec for a given keyword gap (matched by targetKeyword).
   * The rec is minted on-click (see GapRow) and stored in the rec set — absent until first send.
   */
  function findCompetitorRec(keyword: string): Recommendation | undefined {
    return recSet?.recommendations.find(
      r => r.type === 'competitor' && r.targetKeyword === keyword
    );
  }

  if (errorMsg && effectiveGaps.length === 0) {
    return (
      <SectionCard>
        <div className="text-center py-6">
          <p className="t-body text-red-400">{errorMsg}</p>
          <Button onClick={() => refetch()} variant="ghost" size="sm" className="mt-2 t-caption text-teal-400 hover:underline">
            Retry
          </Button>
        </div>
      </SectionCard>
    );
  }

  if (!data && effectiveGaps.length === 0) return null;

  const myDomain = data?.domains.find(d => d.isOwn);
  const compDomains = data?.domains.filter(d => !d.isOwn) ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon as={Target} size="md" className="text-teal-400" />
          <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">Competitive Intelligence</h3>
        </div>
        <Button
          onClick={() => { queryClient.invalidateQueries({ queryKey: queryKeys.admin.competitorIntelAll(workspaceId) }); }}
          variant="ghost"
          size="sm"
          className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
        >
          Refresh
        </Button>
      </div>

      {/* Domain Overview Cards — hidden in the merged Authority & Backlinks leaf (duplicates the backlink stats) */}
      {!merged && myDomain?.overview && (
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Your Organic Traffic" value={fmtNum(myDomain.overview.organicTraffic)} icon={TrendingUp} iconColor="text-teal-400" />
          <StatCard label="Your Keywords" value={fmtNum(myDomain.overview.organicKeywords)} icon={Search} iconColor="text-teal-400" />
          <StatCard label="Your Backlinks" value={fmtNum(myDomain.backlinks?.totalBacklinks || 0)} icon={Link2} iconColor="text-teal-400" />
          <StatCard label="Traffic Value" value={`$${fmtNum(myDomain.overview.organicCost)}`} icon={DollarSign} iconColor="text-teal-400" />
        </div>
      )}

      {/* Competitor Comparison */}
      {compDomains.map(comp => {
        const isExpanded = expanded.has(comp.domain);
        const myOv = myDomain?.overview;
        const compOv = comp.overview;

        return (
          // pr-check-disable-next-line -- brand asymmetric signature on collapsible per-competitor card; non-SectionCard chrome (button-as-first-child)
          <div key={comp.domain} className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
            <ClickableRow
              onClick={() => toggleExpand(comp.domain)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--surface-3)]/50 transition-colors"
            >
              <Icon as={isExpanded ? ChevronDown : ChevronRight} size="sm" className="text-[var(--brand-text-muted)]" />
              <Icon as={Globe} size="md" className="text-orange-400" />
              <span className="t-body font-medium text-[var(--brand-text-bright)] flex-1 text-left">{comp.domain}</span>
              {compOv && (
                <div className="flex items-center gap-4 t-caption-sm text-[var(--brand-text-muted)]">
                  <span>{fmtNum(compOv.organicTraffic)} traffic</span>
                  <span>{fmtNum(compOv.organicKeywords)} keywords</span>
                  <span>{fmtNum(comp.backlinks?.referringDomains || 0)} ref. domains</span>
                </div>
              )}
            </ClickableRow>

            {isExpanded && myOv && compOv && (
              <div className="px-4 pb-4 space-y-4 border-t border-[var(--brand-border)] pt-3">
                {/* Side-by-side bars */}
                <div className="flex items-center gap-6 t-caption-sm mb-2">
                  <span className="text-teal-400 font-medium">{myDomain?.domain}</span>
                  <span className="text-[var(--brand-text-muted)]">vs</span>
                  <span className="text-orange-400 font-medium">{comp.domain}</span>
                </div>
                <div className="space-y-3">
                  <ComparisonBar myVal={myOv.organicTraffic} theirVal={compOv.organicTraffic} label="Organic Traffic" />
                  <ComparisonBar myVal={myOv.organicKeywords} theirVal={compOv.organicKeywords} label="Keywords" />
                  <ComparisonBar myVal={myDomain?.backlinks?.referringDomains || 0} theirVal={comp.backlinks?.referringDomains || 0} label="Referring Domains" />
                  <ComparisonBar myVal={myOv.organicCost} theirVal={compOv.organicCost} label="Traffic Value ($)" />
                </div>

                {/* Competitor's top keywords */}
                {comp.topKeywords.length > 0 && (
                  <div>
                    <h5 className="t-micro uppercase tracking-wider text-[var(--brand-text-muted)] font-semibold mb-2">Their Top Keywords</h5>
                    <div className="space-y-1">
                      {comp.topKeywords.slice(0, 10).map((kw, i) => (
                        <div key={i} className="flex items-center gap-2 t-caption px-2 py-1.5 bg-[var(--surface-1)]/50 rounded-[var(--radius-lg)]">
                          <span className="text-[var(--brand-text-muted)] w-5 text-right font-mono">#{kw.position}</span>
                          <span className="flex-1 text-[var(--brand-text-bright)] truncate">{kw.keyword}</span>
                          <span className="text-[var(--brand-text-muted)] font-mono">{fmtNum(kw.volume)}/mo</span>
                          <span className={`font-mono ${difficultyColor(kw.difficulty)}`}>KD {kw.difficulty}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Keyword Gaps — hidden in the merged leaf (deduped to the standalone CompetitorEvidence surface) */}
      {!merged && effectiveGaps.length > 0 && (
        // pr-check-disable-next-line -- brand asymmetric signature on Keyword Gaps collapsible section; non-SectionCard chrome
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
          <ClickableRow
            onClick={() => toggleExpand('gaps')}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--surface-3)]/50 transition-colors"
          >
            <Icon as={expanded.has('gaps') ? ChevronDown : ChevronRight} size="sm" className="text-[var(--brand-text-muted)]" />
            <Icon as={Target} size="md" className="text-amber-400" />
            <span className="t-body font-medium text-[var(--brand-text-bright)] flex-1 text-left">Keyword Gaps</span>
            {usingFallbackGaps && <span className="t-micro text-amber-500/70 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">from strategy</span>}
            <span className="t-caption-sm text-[var(--brand-text-muted)]">{effectiveGaps.length} opportunities</span>
          </ClickableRow>
          {expanded.has('gaps') && (
            <div className="px-4 pb-4 border-t border-[var(--brand-border)] pt-3">
              <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">Keywords your competitors rank for that you don't — sorted by traffic potential.</p>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {effectiveGaps.map((gap, i) => (
                  <GapRow
                    key={i}
                    gap={gap}
                    workspaceId={workspaceId}
                    rec={findCompetitorRec(gap.keyword)}
                    alreadySent={sentGaps.has(gap.keyword)}
                    onSent={() => setSentGaps(prev => new Set([...prev, gap.keyword]))}
                    showSend={showSend}
                    queryClient={queryClient}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        {(errorMsg && effectiveGaps.length > 0) || data?.degraded ? (
          <p className="t-caption-sm text-amber-500/70">
            {data?.degraded
              ? 'Some live provider data is unavailable — showing the metrics that loaded.'
              : 'Live fetch failed — showing cached data.'}{' '}
            <Button onClick={() => refetch()} variant="ghost" size="sm" className="text-teal-400 hover:underline px-0 py-0 h-auto">
              Retry
            </Button>
          </p>
        ) : null}
        <p className="t-caption-sm text-[var(--brand-text-muted)] text-right ml-auto">
          Data via SEO provider · {usingFallbackGaps
            ? 'Keyword gaps from last strategy run'
            : data?.fetchedAt
              ? (merged
                  // fetchedAt is response-assembly time, not the provider cache age — label it honestly.
                  ? `Updated ${new Date(data.fetchedAt).toLocaleString()}`
                  : `Cached 48h · ${new Date(data.fetchedAt).toLocaleString()}`)
              : ''}
        </p>
      </div>
    </div>
  );
}
